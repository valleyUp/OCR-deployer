import io

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("starlette")
pytest.importorskip("pydantic_settings")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import tasks as tasks_api
from app.api import task_context


def _build_client(tmp_path, monkeypatch) -> TestClient:
    output_dir = tmp_path / "data"
    output_dir.mkdir()
    monkeypatch.setattr(task_context.settings, "OUTPUT_DIR", str(output_dir))
    app = FastAPI()
    app.include_router(tasks_api.router, prefix="/api/v1")
    return TestClient(app)


def test_upload_rejects_files_over_backend_limit(tmp_path, monkeypatch):
    client = _build_client(tmp_path, monkeypatch)
    monkeypatch.setattr(task_context.settings, "MAX_UPLOAD_MB", 1)

    response = client.post(
        "/api/v1/tasks/upload",
        files={
            "file": (
                "large.pdf",
                io.BytesIO(b"x" * (1024 * 1024 + 1)),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 413
    assert "1 MB" in response.json()["detail"]
    assert not any((tmp_path / "data").rglob("large.pdf"))


def test_upload_rejects_custom_url_when_disabled(tmp_path, monkeypatch):
    client = _build_client(tmp_path, monkeypatch)
    monkeypatch.setattr(task_context.settings, "ALLOW_CUSTOM_OCR_URLS", False)

    response = client.post(
        "/api/v1/tasks/upload",
        data={"custom_url": "http://example.com/glmocr/parse"},
        files={
            "file": (
                "source.pdf",
                io.BytesIO(b"%PDF-1.4\n%%EOF\n"),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "custom_url is disabled for this deployment"


def test_upload_rejects_private_custom_url_without_allowlist(tmp_path, monkeypatch):
    client = _build_client(tmp_path, monkeypatch)
    monkeypatch.setattr(task_context.settings, "ALLOW_CUSTOM_OCR_URLS", True)
    monkeypatch.setattr(task_context.settings, "CUSTOM_OCR_ALLOWED_HOSTS", "")

    response = client.post(
        "/api/v1/tasks/upload",
        data={"custom_url": "http://127.0.0.1:5002/glmocr/parse"},
        files={
            "file": (
                "source.pdf",
                io.BytesIO(b"%PDF-1.4\n%%EOF\n"),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "custom_url cannot target local or private addresses"
