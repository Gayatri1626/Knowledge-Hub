from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from langchain_core.documents import Document as LCDocument

from app.main import app
from app.services import rag, vectorstore


class FakeChatModel:
    def __init__(self, content: str):
        self._content = content

    def invoke(self, messages):
        return SimpleNamespace(content=self._content)


@pytest.fixture
def client(monkeypatch):
    fake_chunk = LCDocument(
        page_content="KnowledgeHub is a multi-document RAG assistant with chat memory.",
        metadata={
            "document_id": "doc-1",
            "filename": "notes.txt",
            "chunk_index": 0,
            "page_number": None,
        },
    )
    monkeypatch.setattr(
        vectorstore, "similarity_search", lambda query, k, document_ids=None: [fake_chunk]
    )
    monkeypatch.setattr(
        rag, "get_chat_model", lambda: FakeChatModel("KnowledgeHub lets you chat with your documents [1].")
    )
    monkeypatch.setattr(
        rag, "get_condense_model", lambda: FakeChatModel("What is KnowledgeHub, standalone question?")
    )

    with TestClient(app) as c:
        yield c


def test_chat_returns_answer_with_citations(client):
    conversation = client.post("/conversations", json={"title": "Test"}).json()

    response = client.post(
        "/chat", json={"conversation_id": conversation["id"], "message": "What is KnowledgeHub?"}
    )

    assert response.status_code == 200
    body = response.json()
    assert "KnowledgeHub" in body["answer"]
    assert len(body["citations"]) == 1
    assert body["citations"][0]["filename"] == "notes.txt"
    assert body["citations"][0]["n"] == 1


def test_chat_persists_conversation_history(client):
    conversation = client.post("/conversations", json={"title": "Test"}).json()

    client.post("/chat", json={"conversation_id": conversation["id"], "message": "What is KnowledgeHub?"})
    client.post(
        "/chat",
        json={"conversation_id": conversation["id"], "message": "What about its memory feature?"},
    )

    messages = client.get(f"/conversations/{conversation['id']}/messages").json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]


def test_chat_unknown_conversation_returns_404(client):
    response = client.post("/chat", json={"conversation_id": "does-not-exist", "message": "hi"})
    assert response.status_code == 404


def test_citations_exclude_markers_not_in_answer(client, monkeypatch):
    monkeypatch.setattr(rag, "get_chat_model", lambda: FakeChatModel("No citation markers here."))
    conversation = client.post("/conversations", json={"title": "Test"}).json()

    response = client.post(
        "/chat", json={"conversation_id": conversation["id"], "message": "hello"}
    )

    assert response.json()["citations"] == []
