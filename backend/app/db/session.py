from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.db.models import Base

settings = get_settings()

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def init_models() -> None:
    """Create tables if they don't exist yet. Used for local/sqlite/test runs.

    Against Supabase Postgres in production, schema.sql is the source of truth
    (run once via the Supabase SQL editor) so this is a no-op safety net there.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
