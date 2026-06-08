"""
Task lock manager.

This overlay keeps the upstream database locking behavior and adds a local
concurrency gate so MAX_CONCURRENT_TASKS is an actual runtime limit rather
than only a displayed setting.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskStatus
from app.repository.task import TaskRepository
from app.utils.config import settings
from app.utils.logger import logger


_semaphore: asyncio.BoundedSemaphore | None = None
_semaphore_limit: int | None = None
_held_locks: set[tuple[str, str]] = set()


def _concurrency_limit() -> int:
    return max(1, int(getattr(settings, "MAX_CONCURRENT_TASKS", 1)))


def _get_semaphore() -> asyncio.BoundedSemaphore:
    global _semaphore, _semaphore_limit

    limit = _concurrency_limit()
    if _semaphore is None or _semaphore_limit != limit:
        _semaphore = asyncio.BoundedSemaphore(limit)
        _semaphore_limit = limit
    return _semaphore


class LockManager:
    """Task lock manager."""

    def __init__(self, session: AsyncSession, default_timeout: int = 3600):
        self.session = session
        self.default_timeout = default_timeout
        self.task_repo = TaskRepository(session)

    async def acquire(
        self,
        task_id: str,
        worker_id: str,
        timeout: Optional[int] = None,
    ) -> Optional[Task]:
        """
        Acquire a task lock if both database state and local concurrency allow it.
        """
        lock_timeout = timeout or self.default_timeout
        semaphore = _get_semaphore()

        if semaphore.locked():
            logger.debug(
                "Concurrency limit reached (%s); worker %s will retry later",
                _semaphore_limit,
                worker_id,
            )
            return None

        await semaphore.acquire()
        acquired_key: tuple[str, str] | None = None
        try:
            task = await self.task_repo.acquire_task_lock(
                task_id=task_id,
                worker_id=worker_id,
                lock_timeout=lock_timeout,
            )

            if task:
                acquired_key = (task_id, worker_id)
                _held_locks.add(acquired_key)
                logger.info("Lock acquired for task %s by worker %s", task_id, worker_id)
                return task

            logger.warning(
                "Failed to acquire lock for task %s by worker %s",
                task_id,
                worker_id,
            )
            return None

        except Exception as exc:
            logger.error("Failed to acquire lock for task %s: %s", task_id, exc)
            return None
        finally:
            if acquired_key is None:
                semaphore.release()

    async def release(
        self,
        task_id: str,
        worker_id: str,
        status: str = TaskStatus.COMPLETED,
        error_message: Optional[str] = None,
    ) -> bool:
        """Release a task lock and the corresponding local concurrency slot."""
        success = False
        try:
            success = await self.task_repo.release_task_lock(
                task_id=task_id,
                worker_id=worker_id,
                status=status,
                error_message=error_message,
            )

            if success:
                logger.info("Lock released for task %s by worker %s", task_id, worker_id)

            return success

        except Exception as exc:
            logger.error("Failed to release lock for task %s: %s", task_id, exc)
            return False
        finally:
            key = (task_id, worker_id)
            if key in _held_locks:
                _held_locks.remove(key)
                try:
                    _get_semaphore().release()
                except ValueError:
                    logger.warning(
                        "Concurrency semaphore was already full while releasing %s",
                        task_id,
                    )

    async def renew(self, task_id: str, worker_id: str) -> bool:
        """Renew a task lock."""
        try:
            success = await self.task_repo.renew_task_lock(
                task_id=task_id,
                worker_id=worker_id,
                lock_timeout=self.default_timeout,
            )

            if success:
                logger.debug("Lock renewed for task %s by worker %s", task_id, worker_id)

            return success

        except Exception as exc:
            logger.error("Failed to renew lock for task %s: %s", task_id, exc)
            return False

    async def recover_expired_locks(self) -> int:
        """Recover expired locks."""
        try:
            expired_tasks = await self.task_repo.get_expired_locks(limit=100)

            recovered_count = 0
            for task in expired_tasks:
                try:
                    if task.can_retry:
                        await self.task_repo.reset_task_for_retry(
                            task_id=task.task_id,
                            error_message="Lock expired, recovered for retry",
                        )
                        recovered_count += 1
                        logger.info("Recovered task %s (lock expired)", task.task_id)
                    else:
                        await self.task_repo.update_task_status(
                            task_id=task.task_id,
                            status=TaskStatus.DEAD_LETTER,
                            error_message="Lock expired and max retries exceeded",
                        )
                        logger.warning(
                            "Task %s moved to dead letter (lock expired)",
                            task.task_id,
                        )

                except Exception as exc:
                    logger.error("Failed to recover task %s: %s", task.task_id, exc)

            if recovered_count > 0:
                logger.info("Recovered %s tasks with expired locks", recovered_count)
                await self.session.commit()

            return recovered_count

        except Exception as exc:
            logger.error("Failed to recover expired locks: %s", exc)
            await self.session.rollback()
            return 0


def reset_concurrency_state_for_tests() -> None:
    global _semaphore, _semaphore_limit
    _semaphore = None
    _semaphore_limit = None
    _held_locks.clear()
