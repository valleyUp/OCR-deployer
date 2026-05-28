import asyncio
from datetime import UTC, datetime

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("starlette")
pytest.importorskip("pydantic_settings")
pytest.importorskip("aiosqlite")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import tasks as tasks_api
from app.models.base import Base
from app.models.task import Task
from app.services.owner_service import build_owner_session


def _build_client(tmp_path, monkeypatch):
    output_dir = tmp_path / "data"
    output_dir.mkdir()
    monkeypatch.setattr(tasks_api.settings, "OUTPUT_DIR", str(output_dir))
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


def _task_dir(tmp_path, task_id: str):
    path = tmp_path / "data" / task_id
    path.mkdir(parents=True, exist_ok=True)
    (path / "source.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
    return path


def _create_task(session_factory, tmp_path, *, task_id: str, owner_token: str):
    owner = build_owner_session(owner_token)
    task_dir = _task_dir(tmp_path, task_id)
    source = task_dir / "source.pdf"

    async def insert_task():
        async with session_factory() as session:
            session.add(
                Task(
                    task_id=task_id,
                    owner_hash=owner.owner_hash,
                    document_id=f"doc-{task_id}",
                    original_filename="source.pdf",
                    file_type="pdf",
                    file_size=source.stat().st_size,
                    file_path=str(source),
                    processing_mode="pipeline",
                    priority=2,
                    status="completed",
                    progress=100.0,
                    created_at=datetime.now(UTC),
                )
            )
            await session.commit()

    asyncio.run(insert_task())
    return task_dir


def _task_exists(session_factory, task_id: str) -> bool:
    async def query_task():
        async with session_factory() as session:
            result = await session.execute(select(Task).where(Task.task_id == task_id))
            return result.scalar_one_or_none() is not None

    return asyncio.run(query_task())


def test_list_tasks_is_scoped_to_owner_cookie(tmp_path, monkeypatch):
    client, session_factory, engine = _build_client(tmp_path, monkeypatch)
    _create_task(session_factory, tmp_path, task_id="task-a", owner_token="owner-a")
    _create_task(session_factory, tmp_path, task_id="task-b", owner_token="owner-b")

    anonymous = client.get("/api/v1/tasks/")
    owner_a = client.get("/api/v1/tasks/", cookies=_cookie("owner-a"))
    owner_b = client.get("/api/v1/tasks/", cookies=_cookie("owner-b"))

    assert anonymous.status_code == 200
    assert anonymous.json()["data"]["tasks"] == []
    assert tasks_api.settings.OWNER_COOKIE_NAME in anonymous.cookies
    assert [task["task_id"] for task in owner_a.json()["data"]["tasks"]] == ["task-a"]
    assert [task["task_id"] for task in owner_b.json()["data"]["tasks"]] == ["task-b"]
    asyncio.run(engine.dispose())


def test_get_and_delete_hide_other_owner_task(tmp_path, monkeypatch):
    client, session_factory, engine = _build_client(tmp_path, monkeypatch)
    task_dir = _create_task(
        session_factory,
        tmp_path,
        task_id="task-a",
        owner_token="owner-a",
    )

    denied = client.get("/api/v1/tasks/task-a", cookies=_cookie("owner-b"))
    denied_delete = client.delete("/api/v1/tasks/task-a", cookies=_cookie("owner-b"))
    allowed_delete = client.delete("/api/v1/tasks/task-a", cookies=_cookie("owner-a"))

    assert denied.status_code == 404
    assert denied_delete.status_code == 404
    assert allowed_delete.status_code == 200
    assert not _task_exists(session_factory, "task-a")
    assert not task_dir.exists()
    asyncio.run(engine.dispose())


def test_delete_all_tasks_only_deletes_current_owner(tmp_path, monkeypatch):
    client, session_factory, engine = _build_client(tmp_path, monkeypatch)
    task_a_dir = _create_task(
        session_factory,
        tmp_path,
        task_id="task-a",
        owner_token="owner-a",
    )
    task_b_dir = _create_task(
        session_factory,
        tmp_path,
        task_id="task-b",
        owner_token="owner-b",
    )

    response = client.delete("/api/v1/tasks/", cookies=_cookie("owner-a"))

    assert response.status_code == 200
    assert response.json()["data"]["deleted"] == 1
    assert not _task_exists(session_factory, "task-a")
    assert _task_exists(session_factory, "task-b")
    assert not task_a_dir.exists()
    assert task_b_dir.exists()
    asyncio.run(engine.dispose())
