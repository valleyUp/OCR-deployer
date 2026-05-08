"""Tests for the runtime config endpoint."""

import pytest

fastapi = pytest.importorskip("fastapi")
pytest.importorskip("starlette")
pytest.importorskip("pydantic_settings")

from fastapi.testclient import TestClient

from app.api.config import router
from fastapi import FastAPI


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    return TestClient(app)


def test_config_endpoint_returns_settings_values():
    client = _build_client()
    response = client.get("/api/v1/config")
    assert response.status_code == 200

    body = response.json()
    assert isinstance(body["max_upload_mb"], int) and body["max_upload_mb"] > 0
    assert isinstance(body["worker_count"], int) and body["worker_count"] > 0
    assert (
        isinstance(body["max_concurrent_tasks"], int)
        and body["max_concurrent_tasks"] > 0
    )
    assert (
        isinstance(body["layout_page_parallelism"], int)
        and body["layout_page_parallelism"] >= 1
    )
    assert isinstance(body["task_timeout"], int) and body["task_timeout"] > 0


def test_config_endpoint_reflects_overrides(monkeypatch):
    from app.utils import config as config_module

    monkeypatch.setattr(config_module.settings, "MAX_UPLOAD_MB", 42)
    monkeypatch.setattr(config_module.settings, "LAYOUT_PAGE_PARALLELISM", 3)

    client = _build_client()
    body = client.get("/api/v1/config").json()
    assert body["max_upload_mb"] == 42
    assert body["layout_page_parallelism"] == 3
