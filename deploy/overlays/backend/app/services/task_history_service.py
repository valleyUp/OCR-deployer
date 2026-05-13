"""Task summary helpers for history views."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def _iso(value: Any) -> str | None:
    return value.isoformat() if value else None


def _execution_time(task: Any) -> float | None:
    value = getattr(task, "execution_time", None)
    if value is not None:
        return value
    started_at = getattr(task, "started_at", None)
    completed_at = getattr(task, "completed_at", None)
    if started_at and completed_at:
        return (completed_at - started_at).total_seconds()
    return None


def _result_available(result_file_path: Any) -> bool:
    if not result_file_path:
        return False
    try:
        return Path(str(result_file_path)).exists()
    except OSError:
        return False


def task_to_history_summary(task: Any) -> dict[str, Any]:
    result = getattr(task, "result", None)
    metadata = result.get("metadata") if isinstance(result, dict) else None

    return {
        "task_id": getattr(task, "task_id", None),
        "document_id": getattr(task, "document_id", None),
        "status": getattr(task, "status", None),
        "progress": getattr(task, "progress", None),
        "current_step": getattr(task, "current_step", None),
        "current_stage": getattr(task, "current_step", None),
        "created_at": _iso(getattr(task, "created_at", None)),
        "started_at": _iso(getattr(task, "started_at", None)),
        "completed_at": _iso(getattr(task, "completed_at", None)),
        "error_message": getattr(task, "error_message", None),
        "processing_mode": getattr(task, "processing_mode", None),
        "priority": getattr(task, "priority", None),
        "retry_count": getattr(task, "retry_count", None),
        "original_filename": getattr(task, "original_filename", None),
        "file_size": getattr(task, "file_size", None),
        "file_type": getattr(task, "file_type", None),
        "source_file_path": getattr(task, "file_path", None),
        "result_file_path": getattr(task, "result_file_path", None),
        "result_available": _result_available(getattr(task, "result_file_path", None)),
        "execution_time": _execution_time(task),
        "total_pages": (
            metadata.get("total_pages") if isinstance(metadata, dict) else None
        ),
    }
