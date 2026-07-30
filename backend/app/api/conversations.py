from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Conversation, Message
from app.db.session import get_db
from app.schemas import (
    ConversationListResponse,
    ConversationOut,
    CreateConversationRequest,
    MessageListResponse,
    MessageOut,
    UpdateConversationRequest,
)

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.post("", response_model=ConversationOut, status_code=201)
async def create_conversation(
    request: CreateConversationRequest, db: AsyncSession = Depends(get_db)
) -> ConversationOut:
    conversation = Conversation(
        domain_id=request.domain_id or "jordi-visser",
        title=request.title or "New conversation",
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return ConversationOut.model_validate(conversation)


@router.get("", response_model=ConversationListResponse)
async def list_conversations(
    domain_id: str | None = Query(None), db: AsyncSession = Depends(get_db)
) -> ConversationListResponse:
    stmt = select(Conversation).order_by(Conversation.updated_at.desc())
    if domain_id:
        stmt = stmt.where(Conversation.domain_id == domain_id)

    result = await db.execute(stmt)
    conversations = result.scalars().all()
    return ConversationListResponse(
        conversations=[ConversationOut.model_validate(c) for c in conversations]
    )


@router.patch("/{conversation_id}", response_model=ConversationOut)
async def update_conversation(
    conversation_id: str,
    request: UpdateConversationRequest,
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation.title = request.title
    conversation.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(conversation)
    return ConversationOut.model_validate(conversation)


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> None:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.delete(conversation)
    await db.commit()


@router.get("/{conversation_id}/messages", response_model=MessageListResponse)
async def get_messages(conversation_id: str, db: AsyncSession = Depends(get_db)) -> MessageListResponse:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    result = await db.execute(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
    )
    messages = result.scalars().all()
    return MessageListResponse(messages=[MessageOut.model_validate(m) for m in messages])
