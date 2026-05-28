import pytest

pytest.importorskip("fastapi")
pytest.importorskip("starlette")
pytest.importorskip("pydantic_settings")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.session import router as session_router
from app.utils.config import settings


def test_session_sets_http_only_owner_cookie():
    app = FastAPI()
    app.include_router(session_router, prefix="/api/v1")
    client = TestClient(app)

    response = client.get("/api/v1/session")

    assert response.status_code == 200
    assert response.json()["owner_id"].startswith("anon_")
    assert settings.OWNER_COOKIE_NAME in response.cookies
    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie


def test_session_owner_id_is_stable_for_same_cookie():
    app = FastAPI()
    app.include_router(session_router, prefix="/api/v1")
    client = TestClient(app)

    first = client.get("/api/v1/session")
    second = client.get("/api/v1/session")

    assert first.json()["owner_id"] == second.json()["owner_id"]
