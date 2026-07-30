from pathlib import Path

from app.services.ingestion import load_and_split


def test_load_and_split_chunks_long_text(tmp_path: Path):
    file_path = tmp_path / "notes.txt"
    file_path.write_text("KnowledgeHub is a multi-document RAG assistant. " * 100, encoding="utf-8")

    chunks = load_and_split(file_path, "notes.txt", "text/plain", document_id="doc-1")

    assert len(chunks) > 1
    for i, chunk in enumerate(chunks):
        assert chunk.metadata["document_id"] == "doc-1"
        assert chunk.metadata["filename"] == "notes.txt"
        assert chunk.metadata["chunk_index"] == i
        assert chunk.metadata["page_number"] is None
        assert len(chunk.page_content) <= 1000 + 1  # chunk_size default


def test_load_and_split_skips_blank_content(tmp_path: Path):
    file_path = tmp_path / "blank.md"
    file_path.write_text("   \n\n  ", encoding="utf-8")

    chunks = load_and_split(file_path, "blank.md", "text/markdown", document_id="doc-2")

    assert chunks == []


def test_load_and_split_short_text_single_chunk(tmp_path: Path):
    file_path = tmp_path / "short.txt"
    file_path.write_text("KnowledgeHub answers questions with citations.", encoding="utf-8")

    chunks = load_and_split(file_path, "short.txt", "text/plain", document_id="doc-3")

    assert len(chunks) == 1
    assert chunks[0].page_content == "KnowledgeHub answers questions with citations."
