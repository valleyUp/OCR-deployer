from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select

from app.api import task_context
from app.models.task import Task, TaskStatus
from app.services.formula_service import load_result_file
from app.services.task_cleanup_service import delete_task_files
from app.utils.logger import logger

SUPPORTED_PROCESSING_MODES = {"pipeline", "formula"}
FORMULA_MODE_PROMPT = (
    "Extract only display or block mathematical equations that occupy their own "
    "line or a standalone formula region. Return LaTeX for those display "
    "equations only. Do not extract inline mathematical symbols or formulas "
    "embedded inside prose paragraphs. Ignore standalone formula numbers unless "
    "they are attached to a display equation."
)


async def get_owned_task_or_404(task_id: str, owner_hash: str) -> Task:
    async with task_context.AsyncSessionLocal() as db:
        result = await db.execute(
            select(Task).where(Task.task_id == task_id, Task.owner_hash == owner_hash)
        )
        task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task not found: {task_id}",
        )
    return task


def task_to_status_info(task: Task) -> dict[str, Any]:
    return {
        "task_id": task.task_id,
        "document_id": task.document_id,
        "status": task.status,
        "progress": task.progress,
        "current_step": task.current_step,
        "created_at": task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
        "error_message": task.error_message,
        "result_file_path": task.result_file_path,
        "processing_mode": task.processing_mode,
        "priority": task.priority,
        "retry_count": task.retry_count,
        "worker_id": task.worker_id,
        "original_filename": task.original_filename,
        "source_file_path": task.file_path,
    }


async def get_task_info_or_404(task_id: str, owner_hash: str) -> dict[str, Any]:
    task = await get_owned_task_or_404(task_id, owner_hash)
    return task_to_status_info(task)


def read_task_result(task_info: dict[str, Any]) -> dict[str, Any]:
    result_file_path = task_info.get("result_file_path")
    if not result_file_path:
        return {}

    result_path = Path(str(result_file_path))
    if not result_path.exists():
        logger.warning(f"Result file not found: {result_file_path}")
        return {}

    try:
        return load_result_file(result_path)
    except Exception as exc:
        logger.warning(f"Failed to read result file {result_file_path}: {exc}")
        return {}


def get_task_file_info(task_info: dict[str, Any]) -> dict[str, Any]:
    return {
        "original_filename": task_info.get("original_filename"),
        "source_file_path": task_info.get("source_file_path"),
    }


async def delete_task_and_files(db: Any, task: Task) -> None:
    if task.status in {TaskStatus.PENDING, TaskStatus.PROCESSING}:
        task.status = TaskStatus.CANCELLED
        task.completed_at = datetime.now(UTC)

    try:
        delete_task_files(task.task_id, task_context.settings.OUTPUT_DIR)
    except FileNotFoundError:
        pass

    await db.delete(task)
