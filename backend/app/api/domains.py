import logging
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Conversation, Document, Domain, Message
from app.db.session import get_db
from app.schemas import CreateDomainRequest, DomainListResponse, DomainOut
from app.services import vectorstore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/domains", tags=["domains"])

DEFAULT_DOMAINS_SEED = [
    {
        "id": "jordi-visser",
        "name": "Jordi Visser",
        "description": "Macro economy, AI market developments, physical bottlenecks, and technology research.",
    },
    {
        "id": "tech-ai",
        "name": "Tech & AI Research",
        "description": "LLMs, RAG architectures, neural networks, and AI hardware specifications.",
    },
    {
        "id": "company-policy",
        "name": "Company Policies & HR",
        "description": "Employee guidelines, standard operating procedures, and administrative protocols.",
    },
]


async def _seed_default_domains(db: AsyncSession) -> None:
    result = await db.execute(select(func.count(Domain.id)))
    count = result.scalar() or 0
    if count == 0:
        for seed in DEFAULT_DOMAINS_SEED:
            domain = Domain(
                id=seed["id"],
                name=seed["name"],
                description=seed["description"],
            )
            db.add(domain)
        await db.commit()


@router.get("", response_model=DomainListResponse)
async def list_domains(db: AsyncSession = Depends(get_db)) -> DomainListResponse:
    result = await db.execute(select(Domain).order_by(Domain.created_at))
    domain_rows = result.scalars().all()

    response_items: list[DomainOut] = []
    for d in domain_rows:
        # Calculate doc count & total words for this domain
        doc_stats = await db.execute(
            select(
                func.count(Document.id),
                func.coalesce(func.sum(Document.size_bytes), 0),
            ).where(Document.domain_id == d.id)
        )
        doc_count, total_bytes = doc_stats.one()
        total_words = int(total_bytes // 6) if total_bytes else 0

        item = DomainOut(
            id=d.id,
            name=d.name,
            description=d.description,
            doc_count=doc_count,
            enabled_count=doc_count,
            total_words=total_words,
            created_at=d.created_at,
        )
        response_items.append(item)

    return DomainListResponse(domains=response_items)


@router.post("", response_model=DomainOut, status_code=201)
async def create_domain(
    request: CreateDomainRequest, db: AsyncSession = Depends(get_db)
) -> DomainOut:
    slug = re.sub(r"[^a-z0-9]+", "-", request.name.lower()).strip("-")
    if not slug:
        slug = "domain"
    domain_id = f"{slug}"

    existing = await db.get(Domain, domain_id)
    if existing is not None:
        domain_id = f"{slug}-{int(func.now().get_execution_time() if hasattr(func.now(), 'get_execution_time') else 100)}"

    domain = Domain(
        id=domain_id,
        name=request.name.strip(),
        description=request.description.strip() if request.description else None,
    )
    db.add(domain)
    await db.commit()
    await db.refresh(domain)

    return DomainOut(
        id=domain.id,
        name=domain.name,
        description=domain.description,
        doc_count=0,
        enabled_count=0,
        total_words=0,
        created_at=domain.created_at,
    )


@router.delete("/{domain_id}", status_code=204)
async def delete_domain(domain_id: str, db: AsyncSession = Depends(get_db)) -> None:
    domain = await db.get(Domain, domain_id)
    if domain is None:
        raise HTTPException(status_code=404, detail="Domain not found")

    # Fetch associated documents first to clean up their Qdrant vector embeddings
    # before the rows disappear from Postgres.
    doc_result = await db.execute(select(Document.id).where(Document.domain_id == domain_id))
    domain_document_ids = list(doc_result.scalars().all())

    for document_id in domain_document_ids:
        try:
            vectorstore.delete_by_document_id(document_id)
        except Exception:
            logger.exception(
                "Failed to delete Qdrant chunks for document %s while deleting domain %s",
                document_id,
                domain_id,
            )

    # Delete messages for this domain's conversations explicitly. Bulk `delete()`
    # statements bypass the ORM relationship cascade (that only fires on
    # session.delete() against a loaded parent), and SQLite (used locally/in
    # tests) doesn't enforce FK ON DELETE CASCADE unless explicitly pragma'd on —
    # so history must be removed here rather than assumed to cascade.
    convo_result = await db.execute(
        select(Conversation.id).where(Conversation.domain_id == domain_id)
    )
    domain_conversation_ids = list(convo_result.scalars().all())

    if domain_conversation_ids:
        await db.execute(
            delete(Message).where(Message.conversation_id.in_(domain_conversation_ids))
        )

    # Delete conversations belonging to this domain
    await db.execute(delete(Conversation).where(Conversation.domain_id == domain_id))

    # Delete documents belonging to this domain
    await db.execute(delete(Document).where(Document.domain_id == domain_id))

    # Delete domain record
    await db.delete(domain)
    await db.commit()
