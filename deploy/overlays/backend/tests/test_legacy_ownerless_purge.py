import asyncio
from datetime import UTC, datetime

import pytest

pytest.importorskip("pydantic_settings")
pytest.importorskip("aiosqlite")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import database
from app.models.base import Base
from app.models.task import Task


def test_purge_ownerless_tasks_deletes_db_rows_and_task_dirs(tmp_path, monkeypatch):
    output_dir = tmp_path / "data"
    legacy_dir = output_dir / "legacy-task"
    owned_dir = output_dir / "owned-task"
    legacy_dir.mkdir(parents=True)
    owned_dir.mkdir(parents=True)
    (legacy_dir / "source.pdf").write_bytes(b"legacy")
    (owned_dir / "source.pdf").write_bytes(b"owned")

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'tasks.db'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(database.settings, "OUTPUT_DIR", str(output_dir))
    monkeypatch.setattr(database.settings, "PURGE_LEGACY_OWNERLESS_TASKS", True)
    monkeypatch.setattr(database, "AsyncSessionLocal", session_factory)

    async def setup_db():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with session_factory() as session:
            session.add_all([
                Task(
                    task_id="legacy-task",
                    owner_hash=None,
                    document_id="doc-legacy",
                    original_filename="source.pdf",
                    file_type="pdf",
                    file_size=6,
                    file_path=str(legacy_dir / "source.pdf"),
                    processing_mode="pipeline",
                    priority=2,
                    status="completed",
                    progress=100.0,
                    created_at=datetime.now(UTC),
                ),
                Task(
                    task_id="owned-task",
                    owner_hash="owner-hash",
                    document_id="doc-owned",
                    original_filename="source.pdf",
                    file_type="pdf",
                    file_size=5,
                    file_path=str(owned_dir / "source.pdf"),
                    processing_mode="pipeline",
                    priority=2,
                    status="completed",
                    progress=100.0,
                    created_at=datetime.now(UTC),
                ),
            ])
            await session.commit()

    async def query_task_ids():
        async with session_factory() as session:
            result = await session.execute(select(Task.task_id).order_by(Task.task_id))
            return list(result.scalars().all())

    asyncio.run(setup_db())
    purged = asyncio.run(database.purge_ownerless_tasks())

    assert purged == 1
    assert asyncio.run(query_task_ids()) == ["owned-task"]
    assert not legacy_dir.exists()
    assert owned_dir.exists()
    asyncio.run(engine.dispose())
