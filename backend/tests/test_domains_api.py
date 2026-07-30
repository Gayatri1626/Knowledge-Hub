import io
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
    deleted_document_ids: list[str] = []

    monkeypatch.setattr(
        vectorstore, "add_chunks", lambda chunks: [f"id-{i}" for i in range(len(chunks))]
    )
    monkeypatch.setattr(
        vectorstore, "delete_by_document_id", lambda document_id: deleted_document_ids.append(document_id)
    )

    fake_chunk = LCDocument(
        page_content="Domain-scoped content used for the cascade-delete test.",
        metadata={"document_id": "doc-1", "filename": "notes.txt", "chunk_index": 0, "page_number": None},
    )
    monkeypatch.setattr(
        vectorstore, "similarity_search", lambda query, k, document_ids=None: [fake_chunk]
    )
    monkeypatch.setattr(rag, "get_chat_model", lambda: FakeChatModel("Answer for the domain test [1]."))
    monkeypatch.setattr(rag, "get_condense_model", lambda: FakeChatModel("Standalone question?"))

    with TestClient(app) as c:
        c.deleted_document_ids = deleted_document_ids
        yield c


def _create_domain(client, name="Cascade Delete Test Domain"):
    response = client.post("/domains", json={"name": name, "description": "temp"})
    assert response.status_code == 201
    return response.json()["id"]


def test_deleting_domain_removes_documents_conversations_messages_and_vectors(client):
    domain_id = _create_domain(client)

    # Upload a document into the domain.
    file_content = b"Content that belongs to this domain only. " * 20
    upload = client.post(
        "/documents",
        data={"domain_id": domain_id},
        files={"files": ("scoped.txt", io.BytesIO(file_content), "text/plain")},
    )
    assert upload.status_code == 201
    document_id = upload.json()["documents"][0]["id"]

    # Create a conversation in the domain and generate chat history (messages).
    conversation = client.post(
        "/conversations", json={"title": "Scoped conversation", "domain_id": domain_id}
    ).json()
    conversation_id = conversation["id"]
    chat_response = client.post(
        "/chat", json={"conversation_id": conversation_id, "message": "What is in this domain?"}
    )
    assert chat_response.status_code == 200

    messages_before = client.get(f"/conversations/{conversation_id}/messages").json()["messages"]
    assert len(messages_before) == 2  # user + assistant

    # Sanity check everything is scoped/visible before deletion.
    assert any(d["id"] == document_id for d in client.get("/documents", params={"domain_id": domain_id}).json()["documents"])
    assert any(
        c["id"] == conversation_id
        for c in client.get("/conversations", params={"domain_id": domain_id}).json()["conversations"]
    )

    # Delete the domain.
    delete_response = client.delete(f"/domains/{domain_id}")
    assert delete_response.status_code == 204

    # Domain itself is gone.
    domains_after = client.get("/domains").json()["domains"]
    assert all(d["id"] != domain_id for d in domains_after)

    # Documents in that domain are gone (globally, not just filtered).
    all_documents = client.get("/documents").json()["documents"]
    assert all(d["id"] != document_id for d in all_documents)

    # Conversations in that domain are gone.
    all_conversations = client.get("/conversations").json()["conversations"]
    assert all(c["id"] != conversation_id for c in all_conversations)

    # Messages (history) for that conversation are gone -- conversation itself
    # no longer exists, so fetching its messages now 404s instead of returning
    # orphaned rows.
    messages_after = client.get(f"/conversations/{conversation_id}/messages")
    assert messages_after.status_code == 404

    # Vector DB chunks for the domain's document were explicitly cleaned up.
    assert document_id in client.deleted_document_ids


def test_deleting_domain_twice_returns_404(client):
    domain_id = _create_domain(client, name="Second Cascade Delete Domain")
    first = client.delete(f"/domains/{domain_id}")
    assert first.status_code == 204

    second = client.delete(f"/domains/{domain_id}")
    assert second.status_code == 404


def test_deleting_domain_with_no_data_still_succeeds(client):
    domain_id = _create_domain(client, name="Empty Domain")
    response = client.delete(f"/domains/{domain_id}")
    assert response.status_code == 204
