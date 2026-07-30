from unittest.mock import MagicMock

from langchain_core.documents import Document as LCDocument

from app.services.rerank import rerank_chunks


def test_rerank_chunks_reorders_correctly(monkeypatch):
    doc1 = LCDocument(page_content="First chunk", metadata={"id": "1"})
    doc2 = LCDocument(page_content="Second chunk", metadata={"id": "2"})
    doc3 = LCDocument(page_content="Third chunk", metadata={"id": "3"})
    chunks = [doc1, doc2, doc3]

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "data": [
            {"index": 2, "relevance_score": 0.95},
            {"index": 0, "relevance_score": 0.85},
        ]
    }

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.post.return_value = mock_response

    monkeypatch.setattr("app.services.rerank.httpx.Client", lambda timeout=10.0: mock_client)

    result = rerank_chunks("query", chunks, top_k=2)
    assert len(result) == 2
    assert result[0].page_content == "Third chunk"
    assert result[1].page_content == "First chunk"


def test_rerank_chunks_fallback_on_api_error(monkeypatch):
    doc1 = LCDocument(page_content="First chunk")
    doc2 = LCDocument(page_content="Second chunk")
    chunks = [doc1, doc2]

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.post.side_effect = Exception("API connection failed")

    monkeypatch.setattr("app.services.rerank.httpx.Client", lambda timeout=10.0: mock_client)

    result = rerank_chunks("query", chunks, top_k=1)
    assert len(result) == 1
    assert result[0].page_content == "First chunk"


def test_rerank_chunks_no_api_key(monkeypatch):
    doc1 = LCDocument(page_content="First chunk")
    doc2 = LCDocument(page_content="Second chunk")
    chunks = [doc1, doc2]

    monkeypatch.setattr("app.config.get_settings", lambda: MagicMock(voyage_api_key=""))

    result = rerank_chunks("query", chunks, top_k=1)
    assert len(result) == 1
    assert result[0].page_content == "First chunk"
