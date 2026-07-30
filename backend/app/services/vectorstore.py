import logging
import time
from functools import lru_cache

from langchain_core.documents import Document as LCDocument
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.config import get_settings
from app.services.embeddings import get_embeddings

try:
    from openai import RateLimitError as OpenAIRateLimitError
except ImportError:  # pragma: no cover - openai always ships alongside langchain-openai
    OpenAIRateLimitError = None

logger = logging.getLogger(__name__)

# A tight org-level rate/quota limit on the embedding provider can still happen
# (new OpenAI orgs start on modest tier-1 limits before usage-based tier
# increases kick in), and a large document can need hundreds of embedding
# batches - a single 429 shouldn't fail the whole upload outright. Back off
# long enough for a per-minute quota to reset and retry, logging clearly so
# it's obvious this is an account/tier limit rather than an application bug.
MAX_RATE_LIMIT_RETRIES = 5
RATE_LIMIT_BACKOFF_SECONDS = 65


@lru_cache
def get_qdrant_client() -> QdrantClient:
    settings = get_settings()
    return QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key or None)


def ensure_collection() -> None:
    settings = get_settings()
    client = get_qdrant_client()
    collection_name = settings.effective_qdrant_collection
    if not client.collection_exists(collection_name):
        logger.info(
            "[vectorstore] creating Qdrant collection '%s' (provider=openai, model=%s, dim=%d)",
            collection_name,
            settings.openai_embedding_model,
            settings.embedding_dim,
        )
        client.create_collection(
            collection_name=collection_name,
            vectors_config=qmodels.VectorParams(
                size=settings.embedding_dim, distance=qmodels.Distance.COSINE
            ),
        )
    # Required for filtering/deleting by document_id: some Qdrant deployments (e.g.
    # Qdrant Cloud) reject unindexed payload filters with a 400, even though a local
    # Qdrant instance allows it. Safe to call even if the index already exists.
    client.create_payload_index(
        collection_name=collection_name,
        field_name="metadata.document_id",
        field_schema=qmodels.PayloadSchemaType.KEYWORD,
    )


@lru_cache
def get_vectorstore() -> QdrantVectorStore:
    settings = get_settings()
    ensure_collection()
    return QdrantVectorStore(
        client=get_qdrant_client(),
        collection_name=settings.effective_qdrant_collection,
        embedding=get_embeddings(),
    )


def _is_rate_limit_error(exc: Exception) -> bool:
    if OpenAIRateLimitError is not None and isinstance(exc, OpenAIRateLimitError):
        return True
    # Fallback string match in case the installed openai SDK version raises a
    # differently-typed error for the same underlying 429 condition.
    return "ratelimiterror" in type(exc).__name__.lower() or "rate limit" in str(exc).lower()


def _add_batch_with_retry(store: QdrantVectorStore, batch: list[LCDocument], batch_num: int, total_batches: int) -> list[str]:
    attempt = 0
    while True:
        try:
            return store.add_documents(batch)
        except Exception as exc:
            if not _is_rate_limit_error(exc) or attempt >= MAX_RATE_LIMIT_RETRIES:
                raise
            attempt += 1
            logger.warning(
                "[vectorstore] batch %d/%d hit an embedding provider rate limit (attempt %d/%d): %s. "
                "Backing off %ds before retrying - this is an account/tier limit, not an "
                "application error.",
                batch_num,
                total_batches,
                attempt,
                MAX_RATE_LIMIT_RETRIES,
                exc,
                RATE_LIMIT_BACKOFF_SECONDS,
            )
            time.sleep(RATE_LIMIT_BACKOFF_SECONDS)


def add_chunks(chunks: list[LCDocument], batch_size: int = 25) -> list[str]:
    ids: list[str] = []
    store = get_vectorstore()
    total_batches = (len(chunks) + batch_size - 1) // batch_size
    logger.info(
        "[vectorstore] embedding %d chunk(s) in %d batch(es) of up to %d",
        len(chunks),
        total_batches,
        batch_size,
    )
    for batch_num, i in enumerate(range(0, len(chunks), batch_size), start=1):
        batch = chunks[i : i + batch_size]
        batch_ids = _add_batch_with_retry(store, batch, batch_num, total_batches)
        ids.extend(batch_ids)
        logger.info(
            "[vectorstore] batch %d/%d: embedded + upserted %d chunk(s)",
            batch_num,
            total_batches,
            len(batch_ids),
        )
    return ids


def delete_by_document_id(document_id: str) -> None:
    settings = get_settings()
    result = get_qdrant_client().delete(
        collection_name=settings.effective_qdrant_collection,
        points_selector=qmodels.FilterSelector(
            filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="metadata.document_id", match=qmodels.MatchValue(value=document_id)
                    )
                ]
            )
        ),
    )
    logger.info(
        "[vectorstore] deleted chunks for document_id=%s from Qdrant (status=%s)",
        document_id,
        getattr(result, "status", result),
    )


def similarity_search(query: str, k: int, document_ids: list[str] | None = None) -> list[LCDocument]:
    # An explicit empty list means "scope to zero documents", not "no filter" - the
    # two must stay distinct or a caller with zero ready documents would silently
    # fall back to searching everything (including orphaned/stale vectors).
    if document_ids is not None and len(document_ids) == 0:
        logger.info("[retrieve] query=%r scoped to 0 documents -> skipping search", query)
        return []

    search_filter = None
    if document_ids:
        search_filter = qmodels.Filter(
            must=[
                qmodels.FieldCondition(
                    key="metadata.document_id", match=qmodels.MatchAny(any=document_ids)
                )
            ]
        )

    logger.info(
        "[retrieve] query=%r k=%d scoped_document_ids=%s",
        query,
        k,
        document_ids if document_ids else "ALL",
    )

    # Use the scored variant purely for logging visibility into what got matched
    # and how confidently; the unscored list below is still what's returned so
    # callers (rag.py) don't need to change.
    try:
        scored = get_vectorstore().similarity_search_with_score(query, k=k, filter=search_filter)
        for rank, (doc, score) in enumerate(scored, start=1):
            logger.info(
                "[retrieve] #%d score=%.4f document_id=%s filename=%s chunk_index=%s page=%s preview=%r",
                rank,
                score,
                doc.metadata.get("document_id"),
                doc.metadata.get("filename"),
                doc.metadata.get("chunk_index"),
                doc.metadata.get("page_number"),
                " ".join(doc.page_content.split())[:120],
            )
        results = [doc for doc, _ in scored]
    except Exception:
        # Some Qdrant/LangChain versions may not support the scored variant identically;
        # fall back to the plain call so retrieval itself never breaks over a logging path.
        logger.exception("[retrieve] similarity_search_with_score failed, falling back to similarity_search")
        results = get_vectorstore().similarity_search(query, k=k, filter=search_filter)

    logger.info("[retrieve] returned %d chunk(s)", len(results))
    return results
