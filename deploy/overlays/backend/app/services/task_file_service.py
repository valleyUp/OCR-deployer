"""Helpers for serving persisted task files."""

from __future__ import annotations

from pathlib import Path


class TaskFileAccessError(PermissionError):
    """Raised when a requested task file is outside the allowed data directory."""


def resolve_task_file_path(requested_path: str, output_dir: str) -> Path:
    """Resolve a user-supplied task file path inside the configured output dir."""
    if not requested_path or not requested_path.strip():
        raise FileNotFoundError("empty task file path")

    base_dir = Path(output_dir).expanduser().resolve()
    file_path = Path(requested_path).expanduser()
    if file_path.is_absolute():
        resolved = file_path.resolve(strict=True)
    else:
        try:
            resolved = file_path.resolve(strict=True)
        except FileNotFoundError:
            resolved = (base_dir / file_path).resolve(strict=True)

    if not resolved.is_relative_to(base_dir):
        raise TaskFileAccessError(
            f"task file path is outside output dir: {requested_path}"
        )
    if not resolved.is_file():
        raise IsADirectoryError(str(resolved))
    return resolved
