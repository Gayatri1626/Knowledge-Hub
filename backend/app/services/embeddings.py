from functools import lru_cache

from langchain_openai import OpenAIEmbeddings

from app.config import get_settings


@lru_cache
def get_embeddings() -> OpenAIEmbeddings:
    settings = get_settings()
    return OpenAIEmbeddings(
        api_key=settings.openai_api_key,
        model=settings.openai_embedding_model,
        dimensions=settings.openai_embedding_dim,
    )
