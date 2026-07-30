import io

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import vectorstore


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(
        vectorstore, "add_chunks", lambda chunks: [f"id-{i}" for i in range(len(chunks))]
    )
    monkeypatch.setattr(vectorstore, "delete_by_document_id", lambda document_id: None)
    with TestClient(app) as c:
        yield c


def test_upload_document_becomes_ready(client):
    file_content = b"KnowledgeHub is a RAG assistant. " * 50
    response = client.post(
        "/documents",
        files={"files": ("notes.txt", io.BytesIO(file_content), "text/plain")},
    )
    assert response.status_code == 201
    doc = response.json()["documents"][0]
    assert doc["filename"] == "notes.txt"
    assert doc["status"] == "processing"

    documents = client.get("/documents").json()["documents"]
    match = next(d for d in documents if d["id"] == doc["id"])
    assert match["status"] == "ready"
    assert match["chunk_count"] > 0


def test_upload_rejects_unsupported_extension(client):
    response = client.post(
        "/documents",
        files={"files": ("archive.zip", io.BytesIO(b"binary-data"), "application/zip")},
    )
    assert response.status_code == 400


def test_upload_rejects_empty_file(client):
    response = client.post(
        "/documents",
        files={"files": ("empty.txt", io.BytesIO(b"   "), "text/plain")},
    )
    assert response.status_code == 400


def test_delete_document_removes_it(client):
    file_content = b"Delete me please. " * 20
    upload = client.post(
        "/documents", files={"files": ("todelete.txt", io.BytesIO(file_content), "text/plain")}
    )
    document_id = upload.json()["documents"][0]["id"]

    delete_response = client.delete(f"/documents/{document_id}")
    assert delete_response.status_code == 204

    ids = [d["id"] for d in client.get("/documents").json()["documents"]]
    assert document_id not in ids


def test_delete_unknown_document_returns_404(client):
    response = client.delete("/documents/does-not-exist")
    assert response.status_code == 404
