from app.services.rag import _extract_text


def test_extract_text_from_plain_string():
    assert _extract_text("Paris is the capital of France.") == "Paris is the capital of France."


def test_extract_text_from_block_list_with_thinking():
    # Regression test: claude-sonnet-5 returns .content as a list of typed blocks
    # (thinking + text) rather than a plain string once more than one block is
    # present. Naively str()-ing that list leaked raw block dicts, including
    # thinking-block signatures, into user-facing answers.
    content = [
        {"signature": "abc123", "thinking": "", "type": "thinking"},
        {"text": "Paris is the capital of France.", "type": "text"},
    ]
    assert _extract_text(content) == "Paris is the capital of France."


def test_extract_text_from_multiple_text_blocks():
    content = [
        {"text": "Part one. ", "type": "text"},
        {"text": "Part two.", "type": "text"},
    ]
    assert _extract_text(content) == "Part one. Part two."
