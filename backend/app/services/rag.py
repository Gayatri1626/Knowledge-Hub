import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from functools import lru_cache

from langchain_anthropic import ChatAnthropic
from langchain_core.documents import Document as LCDocument
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.schemas import Citation
from app.services import vectorstore
from app.services.rerank import rerank_chunks

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are KnowledgeHub, an assistant that answers questions strictly using the "
    "numbered source documents provided with each question. Rules:\n"
    "1. Only answer using information contained in the sources below.\n"
    "2. Cite every claim with the bracketed document number(s) it came from, e.g. [1] or [1][3].\n"
    "3. If the sources do not contain the answer, say so plainly instead of guessing.\n"
    "4. Do not fabricate sources or citation numbers that were not provided."
)

CONDENSE_PROMPT = (
    "Decide whether the follow-up question is genuinely a continuation of the conversation "
    "history below (it uses a pronoun, \"it\"/\"that\"/\"this\", or an implicit reference that "
    "only makes sense given what was just discussed) or whether it is a new, unrelated question "
    "that happens to come right after that history.\n\n"
    "- If it IS a continuation: rewrite it as a standalone question that folds in exactly the "
    "context needed to resolve the reference, and nothing more.\n"
    "- If it is NOT a continuation (a topic switch, a question about a different document or "
    "subject): return the follow-up question EXACTLY as written, unchanged. Do not add context "
    "from the history, do not mention prior topics, and do not guess at a document or subject "
    "the user didn't name.\n\n"
    "When in doubt, prefer returning the question unchanged - incorrectly injecting unrelated "
    "history biases retrieval toward the wrong document.\n\n"
    "Return ONLY the resulting question, with no preamble or explanation.\n\n"
    "Conversation history:\n{history}\n\nFollow-up question: {question}"
)

CITATION_PATTERN = re.compile(r"\[(\d+)\]")
SNIPPET_LENGTH = 300


@dataclass
class HistoryTurn:
    role: str
    content: str


@lru_cache
def get_chat_model() -> ChatAnthropic:
    settings = get_settings()
    # No explicit temperature: newer Claude models (e.g. claude-sonnet-5) reject the
    # param outright (400 "temperature is deprecated for this model"), so we rely on
    # each model's own default rather than pinning a value that isn't universally valid.
    return ChatAnthropic(api_key=settings.anthropic_api_key, model=settings.anthropic_model)


@lru_cache
def get_condense_model() -> ChatAnthropic:
    settings = get_settings()
    return ChatAnthropic(api_key=settings.anthropic_api_key, model=settings.anthropic_condense_model)


def _extract_text(content: object) -> str:
    """Newer Claude models (e.g. claude-sonnet-5) return `.content` as a list of
    typed blocks (thinking/text/etc.) rather than a plain string whenever more than
    one block is present. Naively str()-ing that list leaked raw block dicts
    (including thinking-block signatures) into user-facing answers."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        return "".join(parts).strip()
    return str(content).strip()


def _extract_stream_piece(content: object) -> str:
    """Like `_extract_text`, but for a single incremental streaming chunk rather
    than a complete response. Deliberately does NOT strip whitespace - a chunk's
    leading/trailing space is often the separator between it and the previous or
    next chunk (e.g. "Hello" then " world"), and stripping every piece would run
    words together once they're concatenated back into the full answer."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        return "".join(parts)
    return str(content) if content else ""


def _history_to_messages(history: list[HistoryTurn]) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    for turn in history:
        if turn.role == "user":
            messages.append(HumanMessage(turn.content))
        elif turn.role == "assistant":
            messages.append(AIMessage(turn.content))
    return messages


def condense_question(history: list[HistoryTurn], question: str) -> str:
    if not history:
        logger.info("[rag] no history yet; using question as-is: %r", question)
        return question

    transcript = "\n".join(f"{turn.role}: {turn.content}" for turn in history)
    prompt = CONDENSE_PROMPT.format(history=transcript, question=question)
    response = get_condense_model().invoke([HumanMessage(prompt)])
    condensed = _extract_text(response.content)
    logger.info(
        "[rag] condensed question: %r -> %r (history_turns=%d)",
        question,
        condensed or question,
        len(history),
    )
    return condensed or question


@dataclass
class _DocGroup:
    """Holds all chunks belonging to a single source document."""
    document_id: str
    filename: str
    pages: list[int | None]
    chunks: list[LCDocument]


def _group_chunks_by_document(chunks: list[LCDocument]) -> list[_DocGroup]:
    """Group retrieved chunks so each unique document gets one citation number."""
    groups: dict[str, _DocGroup] = {}
    order: list[str] = []

    for chunk in chunks:
        doc_id = chunk.metadata.get("document_id", "unknown")
        page = chunk.metadata.get("page_number")
        if doc_id not in groups:
            groups[doc_id] = _DocGroup(
                document_id=doc_id,
                filename=chunk.metadata.get("filename", "unknown"),
                pages=[],
                chunks=[],
            )
            order.append(doc_id)
        group = groups[doc_id]
        group.chunks.append(chunk)
        if page is not None and page not in group.pages:
            group.pages.append(page)

    return [groups[doc_id] for doc_id in order]


def _build_context_block(doc_groups: list[_DocGroup]) -> str:
    parts = []
    for i, group in enumerate(doc_groups, start=1):
        page_info = ""
        if group.pages:
            sorted_pages = sorted(p for p in group.pages if p is not None)
            page_info = f", pages {', '.join(str(p) for p in sorted_pages)}"
        header = f"[{i}] (source: {group.filename}{page_info})"

        excerpts = "\n\n".join(chunk.page_content for chunk in group.chunks)
        parts.append(f"{header}\n{excerpts}")
    return "\n\n".join(parts)


def _extract_citations(answer: str, doc_groups: list[_DocGroup]) -> list[Citation]:
    seen: list[int] = []
    for match in CITATION_PATTERN.finditer(answer):
        n = int(match.group(1))
        if n not in seen:
            seen.append(n)

    citations: list[Citation] = []
    for n in seen:
        if n < 1 or n > len(doc_groups):
            continue
        group = doc_groups[n - 1]
        # Build a combined snippet from all chunks in the group
        combined_text = "\n\n".join(chunk.page_content for chunk in group.chunks)
        snippet = combined_text[:SNIPPET_LENGTH] + ("..." if len(combined_text) > SNIPPET_LENGTH else "")
        # Use the first page number for the citation (pages are also shown in the frontend)
        first_page = group.pages[0] if group.pages else None
        citations.append(
            Citation(
                n=n,
                document_id=group.document_id,
                filename=group.filename,
                page_number=first_page,
                snippet=snippet,
            )
        )
    return citations


FALLBACK_ANSWER = "I couldn't find any relevant information in the uploaded documents to answer that."


@dataclass
class _PreparedContext:
    """Everything needed to call the chat model, already condensed/retrieved/reranked.
    Shared by the non-streaming and streaming code paths so condense -> retrieve ->
    rerank only has one implementation."""
    doc_groups: list[_DocGroup]
    messages: list[BaseMessage]


def _prepare_context(
    history: list[HistoryTurn], question: str, document_ids: list[str] | None = None
) -> _PreparedContext | None:
    """Runs condense -> retrieve -> rerank -> build-context-block. Returns None if
    nothing relevant was retrieved, in which case callers should show the fallback
    answer instead of calling the chat model at all."""
    settings = get_settings()
    logger.info(
        "[rag] run_rag start: question=%r scoped_document_ids=%s reranking=%s",
        question,
        document_ids if document_ids is not None else "ALL",
        settings.enable_reranking,
    )
    condensed = condense_question(history, question)
    fetch_k = settings.initial_retrieval_k if settings.enable_reranking else settings.retrieval_top_k
    chunks = vectorstore.similarity_search(condensed, k=fetch_k, document_ids=document_ids)

    if not chunks:
        logger.info("[rag] no chunks retrieved for query=%r; returning fallback answer", condensed)
        return None

    if settings.enable_reranking:
        chunks = rerank_chunks(condensed, chunks, top_k=settings.retrieval_top_k)
    else:
        logger.info("[rag] reranking disabled; using vector-similarity order as-is")

    doc_groups = _group_chunks_by_document(chunks)
    logger.info(
        "[rag] final context: %d chunk(s) across %d document(s): %s",
        len(chunks),
        len(doc_groups),
        [(g.document_id, g.filename, len(g.chunks)) for g in doc_groups],
    )

    context_block = _build_context_block(doc_groups)
    user_turn = f"Context:\n{context_block}\n\nQuestion: {question}"

    messages: list[BaseMessage] = [
        SystemMessage(SYSTEM_PROMPT),
        *_history_to_messages(history),
        HumanMessage(user_turn),
    ]
    return _PreparedContext(doc_groups=doc_groups, messages=messages)


def run_rag(
    history: list[HistoryTurn], question: str, document_ids: list[str] | None = None
) -> tuple[str, list[Citation]]:
    prepared = _prepare_context(history, question, document_ids)
    if prepared is None:
        return (FALLBACK_ANSWER, [])

    response = get_chat_model().invoke(prepared.messages)
    answer = _extract_text(response.content)
    citations = _extract_citations(answer, prepared.doc_groups)
    logger.info(
        "[rag] answer generated (%d chars), %d citation(s) actually used: %s",
        len(answer),
        len(citations),
        [(c.n, c.filename, c.page_number) for c in citations],
    )
    return answer, citations


@dataclass
class StreamEvent:
    """One event out of `stream_rag`: either an incremental "token" (partial answer
    text to append) or the final "done" event carrying the complete answer and the
    citations extracted from it (citation extraction needs the full text, so it can
    only happen once generation has finished, not per-token)."""
    type: str  # "token" | "done"
    text: str = ""
    answer: str = ""
    citations: list[Citation] = field(default_factory=list)


async def stream_rag(
    history: list[HistoryTurn], question: str, document_ids: list[str] | None = None
) -> AsyncIterator[StreamEvent]:
    """Streaming counterpart to `run_rag`. Condense/retrieve/rerank still happen as
    one blocking unit (off the event loop thread, via run_in_threadpool) since none
    of those steps can meaningfully stream - only the final generation call does."""
    prepared = await run_in_threadpool(_prepare_context, history, question, document_ids)
    if prepared is None:
        yield StreamEvent(type="token", text=FALLBACK_ANSWER)
        yield StreamEvent(type="done", answer=FALLBACK_ANSWER, citations=[])
        return

    pieces: list[str] = []
    async for chunk in get_chat_model().astream(prepared.messages):
        piece = _extract_stream_piece(chunk.content)
        if piece:
            pieces.append(piece)
            yield StreamEvent(type="token", text=piece)

    answer = "".join(pieces).strip()
    citations = _extract_citations(answer, prepared.doc_groups)
    logger.info(
        "[rag] (stream) answer generated (%d chars), %d citation(s) actually used: %s",
        len(answer),
        len(citations),
        [(c.n, c.filename, c.page_number) for c in citations],
    )
    yield StreamEvent(type="done", answer=answer, citations=citations)

