import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Conversation, Document, Message
from app.db.session import get_db
from app.schemas import ChatRequest, ChatResponse, Citation
from app.services.rag import HistoryTurn, run_rag, stream_rag

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


async def _load_chat_context(
    request: ChatRequest, db: AsyncSession, *, log_prefix: str = "[chat]"
) -> tuple[Conversation, list[HistoryTurn], list[str]]:
    """Shared setup for both the plain and streaming /chat endpoints: look up the
    conversation, pull its recent history, and scope retrieval to this domain's
    ready documents. Raises 404 if the conversation doesn't exist."""
    conversation = await db.get(Conversation, request.conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    logger.info(
        "%s conversation_id=%s domain_id=%s message=%r",
        log_prefix,
        conversation.id,
        conversation.domain_id,
        request.message,
    )

    settings = get_settings()
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == request.conversation_id)
        .order_by(Message.created_at.desc())
        .limit(settings.history_turns)
    )
    history_rows = list(reversed(result.scalars().all()))
    history = [HistoryTurn(role=m.role, content=m.content) for m in history_rows]
    logger.info("%s loaded %d prior message(s) as history context", log_prefix, len(history))

    # Strictly filter ready documents belonging to the conversation's active domain
    ready_ids_result = await db.execute(
        select(Document.id).where(
            Document.status == "ready",
            Document.domain_id == conversation.domain_id,
        )
    )
    ready_document_ids = list(ready_ids_result.scalars().all())
    logger.info(
        "%s domain_id=%s: %d ready document(s) in scope: %s",
        log_prefix,
        conversation.domain_id,
        len(ready_document_ids),
        ready_document_ids,
    )

    return conversation, history, ready_document_ids


async def _persist_turn(
    db: AsyncSession, conversation: Conversation, message: str, answer: str, citations: list[Citation]
) -> None:
    user_message = Message(conversation_id=conversation.id, role="user", content=message)
    assistant_message = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=answer,
        citations=[c.model_dump() for c in citations],
    )
    db.add_all([user_message, assistant_message])
    conversation.updated_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)) -> ChatResponse:
    conversation, history, ready_document_ids = await _load_chat_context(request, db)

    try:
        # run_in_threadpool offloads the synchronous RAG pipeline to a worker thread
        answer, citations = await run_in_threadpool(
            run_rag, history, request.message, ready_document_ids
        )
    except Exception as exc:  # upstream provider failure (Anthropic/Voyage/Qdrant)
        logger.exception("[chat] run_rag failed for conversation_id=%s", conversation.id)
        raise HTTPException(status_code=502, detail=f"Failed to generate an answer: {exc}") from exc

    await _persist_turn(db, conversation, request.message, answer, citations)

    return ChatResponse(conversation_id=conversation.id, answer=answer, citations=citations)


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest, db: AsyncSession = Depends(get_db)) -> StreamingResponse:
    """Server-Sent-Events variant of /chat. Emits `data: {...}\\n\\n` lines:
    `{"type": "token", "text": "..."}` for each incremental piece of the answer as
    Claude generates it, followed by exactly one final
    `{"type": "done", "conversation_id": ..., "citations": [...]}` once generation
    finishes and the turn has been persisted - or `{"type": "error", "detail": ...}`
    if generation fails partway (a plain 502 isn't possible once the stream has
    already started with a 200 status)."""
    conversation, history, ready_document_ids = await _load_chat_context(
        request, db, log_prefix="[chat] (stream)"
    )

    async def event_stream():
        answer = ""
        citations: list[Citation] = []
        try:
            async for event in stream_rag(history, request.message, ready_document_ids):
                if event.type == "token":
                    yield f"data: {json.dumps({'type': 'token', 'text': event.text})}\n\n"
                elif event.type == "done":
                    answer = event.answer
                    citations = event.citations
        except Exception as exc:  # upstream provider failure (Anthropic/Voyage/Qdrant)
            logger.exception("[chat] (stream) run_rag failed for conversation_id=%s", conversation.id)
            yield (
                "data: "
                + json.dumps({"type": "error", "detail": f"Failed to generate an answer: {exc}"})
                + "\n\n"
            )
            return

        await _persist_turn(db, conversation, request.message, answer, citations)

        yield (
            "data: "
            + json.dumps(
                {
                    "type": "done",
                    "conversation_id": conversation.id,
                    "citations": [c.model_dump() for c in citations],
                }
            )
            + "\n\n"
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            # Prevent any intermediary (e.g. the Next.js proxy or a reverse proxy in
            # front of the backend container) from buffering the whole response
            # before forwarding it, which would defeat the point of streaming.
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
