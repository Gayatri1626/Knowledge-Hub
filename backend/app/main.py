import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import chat, conversations, documents, domains
from app.api.domains import _seed_default_domains
from app.config import get_settings
from app.db.session import engine, get_db, init_models
from app.services.vectorstore import ensure_collection

logging.basicConfig(level=logging.INFO)

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_models()
    ensure_collection()
    # Seed default domains on first-ever startup only.
    # This runs once; if the user later deletes all domains, they stay deleted.
    async for db in get_db():
        await _seed_default_domains(db)
        break
    yield
    await engine.dispose()


app = FastAPI(title="KnowledgeHub API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(domains.router)
app.include_router(documents.router)
app.include_router(conversations.router)
app.include_router(chat.router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception) -> JSONResponse:
    logging.getLogger(__name__).exception("Unhandled error")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
