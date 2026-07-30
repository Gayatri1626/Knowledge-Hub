import logging
import time
from pathlib import Path

from langchain_core.documents import Document as LCDocument
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.db.models import Document
from app.db.session import SessionLocal
from app.services import vectorstore

logger = logging.getLogger(__name__)

PREVIEW_LENGTH = 120


def _preview(text: str) -> str:
    flat = " ".join(text.split())
    return flat[:PREVIEW_LENGTH] + ("..." if len(flat) > PREVIEW_LENGTH else "")


def _load_pages(file_path: Path, content_type: str) -> list[tuple[str, int | None]]:
    """Returns (text, page_number) pairs. page_number is None for non-PDF files."""
    if content_type == "application/pdf" or file_path.suffix.lower() == ".pdf":
        reader = PdfReader(str(file_path))
        pages = [(page.extract_text() or "", index + 1) for index, page in enumerate(reader.pages)]
        logger.info("[ingest] %s: extracted %d PDF page(s)", file_path.name, len(pages))
        return pages
    text = file_path.read_text(encoding="utf-8", errors="replace")
    logger.info("[ingest] %s: read as plain text (%d chars)", file_path.name, len(text))
    return [(text, None)]


def load_and_split(
    file_path: Path, filename: str, content_type: str, document_id: str
) -> list[LCDocument]:
    settings = get_settings()
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size, chunk_overlap=settings.chunk_overlap
    )
    logger.info(
        "[ingest] document_id=%s filename=%s: splitting with chunk_size=%d chunk_overlap=%d",
        document_id,
        filename,
        settings.chunk_size,
        settings.chunk_overlap,
    )

    chunks: list[LCDocument] = []
    chunk_index = 0
    pages_with_text = 0
    for text, page_number in _load_pages(file_path, content_type):
        if not text.strip():
            continue
        pages_with_text += 1
        pieces = splitter.split_text(text)
        for piece in pieces:
            chunks.append(
                LCDocument(
                    page_content=piece,
                    metadata={
                        "document_id": document_id,
                        "filename": filename,
                        "chunk_index": chunk_index,
                        "page_number": page_number,
                    },
                )
            )
            logger.debug(
                "[ingest] document_id=%s chunk=%d page=%s len=%d preview=%r",
                document_id,
                chunk_index,
                page_number,
                len(piece),
                _preview(piece),
            )
            chunk_index += 1

    logger.info(
        "[ingest] document_id=%s filename=%s: %d page(s) with text -> %d chunk(s) total",
        document_id,
        filename,
        pages_with_text,
        len(chunks),
    )
    return chunks


async def process_document_upload(
    document_id: str, file_path: Path, filename: str, content_type: str
) -> None:
    """Runs as a FastAPI BackgroundTask: chunk, embed, store, then update status.

    Uses its own DB session since it executes after the request session has closed.
    """
    started = time.monotonic()
    logger.info("[ingest] document_id=%s filename=%s: starting ingestion", document_id, filename)

    async with SessionLocal() as session:
        document = await session.get(Document, document_id)
        if document is None:
            logger.warning(
                "[ingest] document_id=%s: row no longer exists (deleted before processing?); aborting",
                document_id,
            )
            file_path.unlink(missing_ok=True)
            return

        try:
            chunks = await run_in_threadpool(
                load_and_split, file_path, filename, content_type, document_id
            )
            if not chunks:
                raise ValueError("No extractable text found in document")

            embed_started = time.monotonic()
            ids = await run_in_threadpool(vectorstore.add_chunks, chunks)
            logger.info(
                "[ingest] document_id=%s filename=%s: embedded + upserted %d chunk(s) into Qdrant in %.2fs "
                "(vector ids: %s)",
                document_id,
                filename,
                len(ids),
                time.monotonic() - embed_started,
                ids[:5] + (["..."] if len(ids) > 5 else []),
            )

            document.status = "ready"
            document.chunk_count = len(chunks)
            logger.info(
                "[ingest] document_id=%s filename=%s: status=ready chunk_count=%d total_time=%.2fs",
                document_id,
                filename,
                len(chunks),
                time.monotonic() - started,
            )
        except Exception as exc:  # surfaced onto the document row rather than raised
            logger.exception("Failed to process document %s", document_id)
            document.status = "failed"
            document.error = str(exc)
            # add_chunks() embeds in batches, so a failure partway through (e.g. an
            # embedding-provider rate limit) can leave earlier batches already
            # upserted into Qdrant even though the document is marked "failed".
            # Those orphaned vectors are excluded from retrieval anyway (chat.py
            # only ever searches document_ids with status="ready"), but clean them
            # up so a doc that's marked failed never leaves stale chunks behind.
            try:
                await run_in_threadpool(vectorstore.delete_by_document_id, document_id)
            except Exception:
                logger.exception(
                    "[ingest] document_id=%s: failed to clean up partially-embedded Qdrant "
                    "chunks after ingestion failure",
                    document_id,
                )
        finally:
            await session.commit()
            file_path.unlink(missing_ok=True)
