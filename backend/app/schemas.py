from datetime import datetime

from pydantic import BaseModel, Field


class DomainOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    doc_count: int = 0
    enabled_count: int = 0
    total_words: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class DomainListResponse(BaseModel):
    domains: list[DomainOut]


class CreateDomainRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class DocumentOut(BaseModel):
    id: str
    domain_id: str = "jordi-visser"
    filename: str
    content_type: str
    size_bytes: int
    status: str
    chunk_count: int
    error: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentListResponse(BaseModel):
    documents: list[DocumentOut]


class ConversationOut(BaseModel):
    id: str
    domain_id: str = "jordi-visser"
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationListResponse(BaseModel):
    conversations: list[ConversationOut]


class CreateConversationRequest(BaseModel):
    title: str | None = None
    domain_id: str = "jordi-visser"


class UpdateConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class Citation(BaseModel):
    n: int
    document_id: str
    filename: str
    page_number: int | None = None
    snippet: str


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    citations: list[Citation] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageListResponse(BaseModel):
    messages: list[MessageOut]


class ChatRequest(BaseModel):
    conversation_id: str
    message: str = Field(min_length=1, max_length=8000)


class ChatResponse(BaseModel):
    conversation_id: str
    answer: str
    citations: list[Citation]
