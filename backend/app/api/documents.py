import logging
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Query, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Document
from app.db.session import get_db
from app.schemas import DocumentListResponse, DocumentOut
from app.services import ingestion, vectorstore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"


@router.post("", response_model=DocumentListResponse, status_code=201)
async def upload_documents(
    background_tasks: BackgroundTasks,
    files: list[UploadFile],
    domain_id: str = Form("jordi-visser"),
    db: AsyncSession = Depends(get_db),
) -> DocumentListResponse:
    settings = get_settings()
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    logger.info(
        "[upload] received %d file(s) for domain=%s: %s",
        len(files),
        domain_id,
        [f.filename for f in files],
    )

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    created: list[Document] = []

    for upload in files:
        extension = Path(upload.filename or "").suffix.lower()
        if extension not in settings.allowed_extensions:
            logger.warning(
                "[upload] rejected '%s': unsupported extension '%s'", upload.filename, extension
            )
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{extension}'. Allowed: {', '.join(settings.allowed_extensions)}",
            )

        content = await upload.read()
        if len(content) > settings.max_upload_bytes:
            logger.warning(
                "[upload] rejected '%s': %d bytes exceeds %d byte limit",
                upload.filename,
                len(content),
                settings.max_upload_bytes,
            )
            raise HTTPException(
                status_code=400,
                detail=f"'{upload.filename}' exceeds the {settings.max_upload_bytes // (1024 * 1024)}MB upload limit",
            )
        if not content.strip():
            logger.warning("[upload] rejected '%s': empty file", upload.filename)
            raise HTTPException(status_code=400, detail=f"'{upload.filename}' is empty")

        document = Document(
            domain_id=domain_id,
            filename=upload.filename or "untitled",
            content_type=upload.content_type or "application/octet-stream",
            size_bytes=len(content),
            status="processing",
        )
        db.add(document)
        await db.flush()

        stored_path = UPLOAD_DIR / f"{document.id}{extension}"
        stored_path.write_bytes(content)

        logger.info(
            "[upload] document_id=%s filename=%s size_bytes=%d domain=%s -> queued for ingestion",
            document.id,
            document.filename,
            document.size_bytes,
            domain_id,
        )

        background_tasks.add_task(
            ingestion.process_document_upload,
            document.id,
            stored_path,
            document.filename,
            document.content_type,
        )
        created.append(document)

    await db.commit()
    for document in created:
        await db.refresh(document)

    return DocumentListResponse(documents=[DocumentOut.model_validate(d) for d in created])


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    domain_id: str | None = Query(None), db: AsyncSession = Depends(get_db)
) -> DocumentListResponse:
    stmt = select(Document).order_by(Document.created_at.desc())
    if domain_id:
        stmt = stmt.where(Document.domain_id == domain_id)

    result = await db.execute(stmt)
    documents = result.scalars().all()
    return DocumentListResponse(documents=[DocumentOut.model_validate(d) for d in documents])


@router.delete("/{document_id}", status_code=204)
async def delete_document(document_id: str, db: AsyncSession = Depends(get_db)) -> None:
    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    vectorstore.delete_by_document_id(document_id)
    await db.execute(delete(Document).where(Document.id == document_id))
    await db.commit()
