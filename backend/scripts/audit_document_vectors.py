"""One-off diagnostic: for every document Postgres marks status="ready", check whether
it actually has any chunks in the currently-active Qdrant collection.

This catches documents that were embedded under a since-removed provider (e.g. Voyage,
before the switch to OpenAI-only embeddings) - their Postgres row still says "ready",
but their vectors live in a collection this app no longer searches, so they're silently
invisible to retrieval despite looking healthy in the UI.

Run from backend/ with the venv active:
    python scripts/audit_document_vectors.py [--domain DOMAIN_ID]
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.config import get_settings
from app.db.models import Document
from app.db.session import SessionLocal
from app.services.vectorstore import get_qdrant_client


async def main(domain_id: str | None) -> None:
    settings = get_settings()
    collection = settings.effective_qdrant_collection
    client = get_qdrant_client()

    async with SessionLocal() as session:
        stmt = select(Document).where(Document.status == "ready")
        if domain_id:
            stmt = stmt.where(Document.domain_id == domain_id)
        result = await session.execute(stmt)
        documents = result.scalars().all()

    if not documents:
        print("No ready documents found" + (f" for domain '{domain_id}'" if domain_id else "") + ".")
        return

    print(f"Checking {len(documents)} ready document(s) against Qdrant collection '{collection}'...\n")
    print(f"{'STATUS':<10} {'ACTUAL':>8} {'EXPECTED':>10}  DOMAIN         FILENAME")
    print("-" * 90)

    orphaned = []
    for doc in documents:
        count_result = client.count(
            collection_name=collection,
            count_filter={
                "must": [
                    {"key": "metadata.document_id", "match": {"value": doc.id}}
                ]
            },
            exact=True,
        )
        actual = count_result.count
        expected = doc.chunk_count
        flag = "OK" if actual > 0 else "ORPHANED"
        if actual == 0:
            orphaned.append(doc)
        print(f"{flag:<10} {actual:>8} {expected:>10}  {doc.domain_id:<14} {doc.filename}")

    print()
    if orphaned:
        print(f"{len(orphaned)} document(s) are marked 'ready' but have ZERO vectors in '{collection}':")
        for doc in orphaned:
            print(f"  - {doc.filename} (id={doc.id}, domain={doc.domain_id})")
        print(
            "\nThese are almost certainly leftover from before the embedding provider switch. "
            "Delete and re-upload them so they get embedded into the current collection."
        )
    else:
        print("All ready documents have vectors in the current collection. Nothing orphaned.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--domain", default=None, help="Limit the check to one domain_id")
    args = parser.parse_args()
    asyncio.run(main(args.domain))
