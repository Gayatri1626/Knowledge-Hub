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
        page_content="Some content.",
        metadata={"document_id": "doc-1", "filename": "notes.txt", "chunk_index": 0, "page_number": None},
    )
    monkeypatch.setattr(
        vectorstore, "similarity_search", lambda query, k, document_ids=None: [fake_chunk]
    )
    monkeypatch.setattr(rag, "get_chat_model", lambda: FakeChatModel("An answer [1]."))
    monkeypatch.setattr(rag, "get_condense_model", lambda: FakeChatModel("Standalone question?"))

    with TestClient(app) as c:
        yield c


def test_delete_conversation_removes_its_messages(client):
    conversation = client.post("/conversations", json={"title": "Test"}).json()
    conversation_id = conversation["id"]

    client.post("/chat", json={"conversation_id": conversation_id, "message": "hello"})
    messages_before = client.get(f"/conversations/{conversation_id}/messages").json()["messages"]
    assert len(messages_before) == 2

    delete_response = client.delete(f"/conversations/{conversation_id}")
    assert delete_response.status_code == 204

    conversations_after = client.get("/conversations").json()["conversations"]
    assert all(c["id"] != conversation_id for c in conversations_after)

    messages_after = client.get(f"/conversations/{conversation_id}/messages")
    assert messages_after.status_code == 404


def test_delete_unknown_conversation_returns_404(client):
    response = client.delete("/conversations/does-not-exist")
    assert response.status_code == 404
