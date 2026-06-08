import asyncio

import pytest

pytest.importorskip("pydantic_settings")

from app.core import lock_manager
from app.core.lock_manager import LockManager


class FakeTask:
    def __init__(self, task_id: str):
        self.task_id = task_id


class FakeTaskRepository:
    def __init__(self):
        self.acquire_calls = 0
        self.release_calls = 0

    async def acquire_task_lock(self, *, task_id, worker_id, lock_timeout):
        self.acquire_calls += 1
        return FakeTask(task_id)

    async def release_task_lock(self, *, task_id, worker_id, status, error_message):
        self.release_calls += 1
        return True


def test_lock_manager_respects_max_concurrent_tasks(monkeypatch):
    async def run():
        monkeypatch.setattr(lock_manager.settings, "MAX_CONCURRENT_TASKS", 1)
        lock_manager.reset_concurrency_state_for_tests()

        first_repo = FakeTaskRepository()
        first = LockManager(session=object())
        first.task_repo = first_repo

        second_repo = FakeTaskRepository()
        second = LockManager(session=object())
        second.task_repo = second_repo

        assert await first.acquire("task-1", "worker-1") is not None
        assert await second.acquire("task-2", "worker-2") is None
        assert first_repo.acquire_calls == 1
        assert second_repo.acquire_calls == 0

        assert await first.release("task-1", "worker-1")
        assert await second.acquire("task-2", "worker-2") is not None
        assert second_repo.acquire_calls == 1

        await second.release("task-2", "worker-2")
        lock_manager.reset_concurrency_state_for_tests()

    asyncio.run(run())
