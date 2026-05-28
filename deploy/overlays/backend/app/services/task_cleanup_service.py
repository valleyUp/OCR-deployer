"""Task file cleanup helpers."""

from __future__ import annotations

from pathlib import Path
import shutil

from app.services.task_file_service import TaskFileAccessError


def task_output_dir(task_id: str, output_dir: str) -> Path:
    base_dir = Path(output_dir).expanduser().resolve()
    task_dir = (base_dir / task_id).resolve()
    if task_dir == base_dir or not task_dir.is_relative_to(base_dir):
        raise TaskFileAccessError(f"task directory is outside output dir: {task_id}")
    return task_dir


def delete_task_files(task_id: str, output_dir: str) -> bool:
    task_dir = task_output_dir(task_id, output_dir)
    if not task_dir.exists():
        return False
    if task_dir.is_symlink():
        raise TaskFileAccessError(f"refusing to delete symlink task dir: {task_id}")
    if task_dir.is_dir():
        shutil.rmtree(task_dir)
        return True
    task_dir.unlink()
    return True
