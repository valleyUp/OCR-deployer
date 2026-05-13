"""Tests for task file preview responses."""

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("starlette")
pytest.importorskip("pydantic_settings")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import tasks as tasks_api


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(tasks_api.router, prefix="/api/v1")
    return TestClient(app)


def test_file_endpoint_returns_pdf_inline(tmp_path, monkeypatch):
    monkeypatch.setattr(tasks_api.settings, "OUTPUT_DIR", str(tmp_path))
    pdf = tmp_path / "source file.pdf"
    content = b"%PDF-1.4\n%%EOF\n"
    pdf.write_bytes(content)

    response = _build_client().get("/api/v1/tasks/file", params={"path": str(pdf)})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.headers["content-disposition"] == 'inline; filename="source file.pdf"'
    assert response.content == content


def test_file_endpoint_rejects_path_outside_output_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(tasks_api.settings, "OUTPUT_DIR", str(tmp_path / "data"))
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"%PDF-1.4\n%%EOF\n")

    response = _build_client().get("/api/v1/tasks/file", params={"path": str(outside)})

    assert response.status_code == 403
