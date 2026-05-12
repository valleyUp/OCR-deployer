"""Tests for task file preview responses."""

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("starlette")
pytest.importorskip("pydantic_settings")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.tasks import router


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    return TestClient(app)


def test_file_endpoint_returns_pdf_inline(tmp_path):
    pdf = tmp_path / "source file.pdf"
    content = b"%PDF-1.4\n%%EOF\n"
    pdf.write_bytes(content)

    response = _build_client().get("/api/v1/tasks/file", params={"path": str(pdf)})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.headers["content-disposition"] == 'inline; filename="source file.pdf"'
    assert response.content == content

