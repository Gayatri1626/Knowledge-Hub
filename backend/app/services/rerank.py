import logging
import httpx
from langchain_core.documents import Document as LCDocument

from app.config import get_settings

logger = logging.getLogger(__name__)

VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank"


def rerank_chunks(
    query: str, chunks: list[LCDocument], top_k: int
) -> list[LCDocument]:
    """Reranks candidate chunks using Voyage AI's Re-ranking API.

    Returns the top_k chunks ordered by relevance score. If Voyage API key is missing
    or if the API request encounters an error, gracefully falls back to the original order.
    """
    if not chunks:
        return []

    settings = get_settings()
    api_key = settings.voyage_api_key
    if not api_key:
        logger.warning("[rerank] VOYAGE_API_KEY is not set; skipping reranking.")
        return chunks[:top_k]

    logger.info(
        "[rerank] query=%r model=%s candidates=%d requested_top_k=%d",
        query,
        settings.voyage_rerank_model,
        len(chunks),
        top_k,
    )
    for i, chunk in enumerate(chunks):
        logger.debug(
            "[rerank] candidate[%d] document_id=%s filename=%s chunk_index=%s preview=%r",
            i,
            chunk.metadata.get("document_id"),
            chunk.metadata.get("filename"),
            chunk.metadata.get("chunk_index"),
            " ".join(chunk.page_content.split())[:120],
        )

    try:
        documents = [chunk.page_content for chunk in chunks]
        payload = {
            "model": settings.voyage_rerank_model,
            "query": query,
            "documents": documents,
            "top_k": min(top_k, len(chunks)),
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        with httpx.Client(timeout=10.0) as client:
            response = client.post(VOYAGE_RERANK_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        results = data.get("data", [])
        reranked: list[LCDocument] = []
        for rank, item in enumerate(results, start=1):
            idx = item.get("index")
            score = item.get("relevance_score")
            if idx is not None and 0 <= idx < len(chunks):
                chunk = chunks[idx]
                reranked.append(chunk)
                logger.info(
                    "[rerank] #%d relevance_score=%s original_index=%d document_id=%s filename=%s chunk_index=%s",
                    rank,
                    score,
                    idx,
                    chunk.metadata.get("document_id"),
                    chunk.metadata.get("filename"),
                    chunk.metadata.get("chunk_index"),
                )

        if reranked:
            logger.info("[rerank] returning %d reranked chunk(s)", len(reranked))
            return reranked
        logger.warning("[rerank] Voyage returned no usable results; falling back to vector order")
    except Exception as exc:
        logger.warning("[rerank] Reranking failed (%s); falling back to vector similarity order.", exc)

    return chunks[:top_k]
