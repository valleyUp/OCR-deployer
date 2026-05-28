"""Tests for task file preview responses."""

import asyncio
from datetime import UTC, datetime

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("starlette")
pytest.importorskip("pydantic_settings")
pytest.importorskip("aiosqlite")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import tasks as tasks_api
from app.models.base import Base
from app.models.task import Task
from app.services.owner_service import build_owner_session


def _build_client(tmp_path, monkeypatch):
    monkeypatch.setattr(tasks_api.settings, "OUTPUT_DIR", str(tmp_path / "data"))
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'tasks.db'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def setup_db():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(setup_db())
    monkeypatch.setattr(tasks_api, "AsyncSessionLocal", session_factory)
    app = FastAPI()
    app.include_router(tasks_api.router, prefix="/api/v1")
    return TestClient(app), session_factory, engine


def _cookie(token: str) -> dict[str, str]:
    return {tasks_api.settings.OWNER_COOKIE_NAME: token}


def _create_task(session_factory, *, task_id: str, owner_token: str, file_path: str):
    owner = build_owner_session(owner_token)

    async def insert_task():
        async with session_factory() as session:
            session.add(
                Task(
                    task_id=task_id,
                    owner_hash=owner.owner_hash,
                    document_id=f"doc-{task_id}",
                    original_filename="source file.pdf",
                    file_type="pdf",
                    file_size=12,
                    file_path=file_path,
                    processing_mode="pipeline",
                    priority=2,
                    status="completed",
                    progress=100.0,
                    created_at=datetime.now(UTC),
                )
            )
            await session.commit()

    asyncio.run(insert_task())


def test_file_endpoint_returns_pdf_inline_for_owner(tmp_path, monkeypatch):
    client, session_factory, engine = _build_client(tmp_path, monkeypatch)
    pdf = tmp_path / "data" / "task-1" / "source file.pdf"
    pdf.parent.mkdir(parents=True)
    content = b"%PDF-1.4\n%%EOF\n"
    pdf.write_bytes(content)
    _create_task(
        session_factory,
        task_id="task-1",
        owner_token="owner-a",
        file_path=str(pdf),
    )

    response = client.get(
        "/api/v1/tasks/file",
        params={"path": str(pdf)},
        cookies=_cookie("owner-a"),
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.headers["content-disposition"] == 'inline; filename="source file.pdf"'
    assert response.content == content
    asyncio.run(engine.dispose())


def test_file_endpoint_hides_other_owner_file(tmp_path, monkeypatch):
    client, session_factory, engine = _build_client(tmp_path, monkeypatch)
    pdf = tmp_path / "data" / "task-1" / "source file.pdf"
    pdf.parent.mkdir(parents=True)
    pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")
    _create_task(
        session_factory,
        task_id="task-1",
        owner_token="owner-a",
        file_path=str(pdf),
    )

    response = client.get(
        "/api/v1/tasks/file",
        params={"path": str(pdf)},
        cookies=_cookie("owner-b"),
    )

    assert response.status_code == 404
    asyncio.run(engine.dispose())


def test_file_endpoint_rejects_path_outside_output_dir(tmp_path, monkeypatch):
    client, _, engine = _build_client(tmp_path, monkeypatch)
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"%PDF-1.4\n%%EOF\n")

    response = client.get("/api/v1/tasks/file", params={"path": str(outside)})

    assert response.status_code == 403
    asyncio.run(engine.dispose())
