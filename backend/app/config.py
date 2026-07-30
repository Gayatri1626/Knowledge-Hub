from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    voyage_api_key: str = ""
    openai_api_key: str = ""

    database_url: str = "sqlite+aiosqlite:///./knowledgehub.db"

    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""
    qdrant_collection: str = "document_chunks"

    cors_origins: str = "http://localhost:3000"

    anthropic_model: str = "claude-sonnet-5"
    anthropic_condense_model: str = "claude-haiku-4-5-20251001"

    # Embeddings always use OpenAI now (Voyage is only kept for reranking below,
    # which is a single low-volume call per chat turn hitting a different
    # endpoint entirely, not the bulk per-chunk embedding calls that used to hit
    # Voyage's free-tier rate limit during ingestion).
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embedding_dim: int = 1536

    enable_reranking: bool = True
    voyage_rerank_model: str = "rerank-2"

    chunk_size: int = 1000
    chunk_overlap: int = 150
    initial_retrieval_k: int = 12
    retrieval_top_k: int = 5
    history_turns: int = 10

    max_upload_bytes: int = 25 * 1024 * 1024
    allowed_extensions: tuple[str, ...] = (".pdf", ".txt", ".md")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def embedding_dim(self) -> int:
        """Vector size embeddings are produced at — must match whatever the
        Qdrant collection was created with."""
        return self.openai_embedding_dim

    @property
    def effective_qdrant_collection(self) -> str:
        """Any documents previously embedded with Voyage live in a different,
        incompatible vector space (and usually a different dimension) than the
        OpenAI embeddings this app now uses exclusively. Keeping the "_openai"
        suffix (rather than reusing the original collection name) means this
        app never tries to write OpenAI vectors into a collection that was
        created with Voyage's dimension - at the cost of needing to re-upload
        any documents that were embedded before this switch."""
        return f"{self.qdrant_collection}_openai"


@lru_cache
def get_settings() -> Settings:
    return Settings()
