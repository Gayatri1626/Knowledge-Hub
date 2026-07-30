import os
from pathlib import Path

TEST_DB_PATH = Path(__file__).resolve().parent / "test_knowledgehub.db"

os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
os.environ.setdefault("VOYAGE_API_KEY", "test-voyage-key")
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{TEST_DB_PATH}")
os.environ.setdefault("QDRANT_URL", "http://localhost:6333")

import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _clean_test_db():
    TEST_DB_PATH.unlink(missing_ok=True)
    yield
    TEST_DB_PATH.unlink(missing_ok=True)


@pytest.fixture(autouse=True)
def _stub_qdrant_startup(monkeypatch):
    # The app's lifespan calls ensure_collection() against a real Qdrant instance on
    # startup; tests mock individual vectorstore functions per-file but don't run a
    # real Qdrant, so this stub keeps TestClient(app) from failing to connect.
    monkeypatch.setattr("app.main.ensure_collection", lambda: None)
