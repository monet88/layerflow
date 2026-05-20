import os
import pytest
from cryptography.fernet import Fernet

# Inject test environment variables before importing any app modules
os.environ["ENV"] = "testing"
os.environ["APP_API_KEY"] = "test-api-key"
os.environ["ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["SQLITE_PATH"] = "data/test_app.sqlite"
os.environ["IMAGE_PROVIDER"] = "mock"
os.environ["MAX_UPLOAD_MB"] = "1"  # Set to 1MB to ease size validation testing

from app.db.sqlite import init_db
from main import app

@pytest.fixture(autouse=True)
def setup_test_db():
    """Ensure a clean test database is initialized for each test run."""
    db_path = "data/test_app.sqlite"
    if os.path.exists(db_path):
        try:
            os.remove(db_path)
        except Exception:
            pass
    init_db()
    yield
    if os.path.exists(db_path):
        try:
            os.remove(db_path)
        except Exception:
            pass

@pytest.fixture
def client():
    """FastAPI TestClient instance."""
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        yield c
