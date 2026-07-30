import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from langchain_core.documents import Document as LCDocument

from app.main import app
from app.services import rag, vectorstore


class FakeStreamingChatModel:
    """Mimics ChatAnthropic's .astream() by yielding one chunk per word, and also
    supports .invoke() so it can double as the condense model in these tests."""

    def __init__(self, content: str):
        self._content = content

    def invoke(self, messages):
        return SimpleNamespace(content=self._content)

    async def astream(self, messages):
        words = self._content.split(" ")
        for i, word in enumerate(words):
            piece = word if i == 0 else " " + word
            yield SimpleNamespace(content=piece)


def _parse_sse_events(body: str) -> list[dict]:
    events = []
    for line in body.split("\n\n"):
        line = line.strip()
        if not line:
            continue
        assert line.startswith("data: ")
        events.append(json.loads(line[len("data: "):]))
    return events


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
        rag, "get_chat_model", lambda: FakeStreamingChatModel("KnowledgeHub lets you chat with your documents [1].")
    )
    monkeypatch.setattr(
        rag, "get_condense_model", lambda: FakeStreamingChatModel("What is KnowledgeHub, standalone question?")
    )

    with TestClient(app) as c:
        yield c


def test_chat_stream_emits_tokens_then_done_with_citations(client):
    conversation = client.post("/conversations", json={"title": "Test"}).json()

    response = client.post(
        "/chat/stream",
        json={"conversation_id": conversation["id"], "message": "What is KnowledgeHub?"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse_events(response.text)
    assert len(events) > 1

    token_events = [e for e in events if e["type"] == "token"]
    done_events = [e for e in events if e["type"] == "done"]
    assert len(done_events) == 1

    streamed_text = "".join(e["text"] for e in token_events)
    assert "KnowledgeHub" in streamed_text

    done = done_events[0]
    assert done["conversation_id"] == conversation["id"]
    assert len(done["citations"]) == 1
    assert done["citations"][0]["filename"] == "notes.txt"
    assert done["citations"][0]["n"] == 1


def test_chat_stream_persists_conversation_history(client):
    conversation = client.post("/conversations", json={"title": "Test"}).json()

    client.post(
        "/chat/stream", json={"conversation_id": conversation["id"], "message": "What is KnowledgeHub?"}
    )

    messages = client.get(f"/conversations/{conversation['id']}/messages").json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert "KnowledgeHub" in messages[1]["content"]
    assert len(messages[1]["citations"]) == 1


def test_chat_stream_unknown_conversation_returns_404(client):
    response = client.post(
        "/chat/stream", json={"conversation_id": "does-not-exist", "message": "hi"}
    )
    assert response.status_code == 404


def test_chat_stream_no_chunks_falls_back_gracefully(client, monkeypatch):
    monkeypatch.setattr(vectorstore, "similarity_search", lambda query, k, document_ids=None: [])
    conversation = client.post("/conversations", json={"title": "Test"}).json()

    response = client.post(
        "/chat/stream", json={"conversation_id": conversation["id"], "message": "hello"}
    )

    events = _parse_sse_events(response.text)
    done = next(e for e in events if e["type"] == "done")
    assert done["citations"] == []

    streamed_text = "".join(e["text"] for e in events if e["type"] == "token")
    assert "couldn't find any relevant information" in streamed_text
