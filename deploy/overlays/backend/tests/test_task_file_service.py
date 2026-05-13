import pytest

from app.services.task_file_service import TaskFileAccessError, resolve_task_file_path


def test_resolve_task_file_path_accepts_output_file(tmp_path):
    source = tmp_path / "task-1" / "source.pdf"
    source.parent.mkdir()
    source.write_bytes(b"%PDF-1.4\n")

    assert resolve_task_file_path(str(source), str(tmp_path)) == source.resolve()


def test_resolve_task_file_path_accepts_relative_output_file(tmp_path, monkeypatch):
    source = tmp_path / "task-1" / "source.pdf"
    source.parent.mkdir()
    source.write_bytes(b"%PDF-1.4\n")
    monkeypatch.chdir(tmp_path)

    assert resolve_task_file_path("task-1/source.pdf", str(tmp_path)) == source.resolve()


def test_resolve_task_file_path_rejects_path_traversal(tmp_path):
    outside = tmp_path.parent / "outside-task-file.txt"
    outside.write_text("outside", encoding="utf-8")

    try:
        with pytest.raises(TaskFileAccessError):
            resolve_task_file_path(str(outside), str(tmp_path))
    finally:
        outside.unlink(missing_ok=True)


def test_resolve_task_file_path_rejects_symlink_escape(tmp_path):
    outside = tmp_path.parent / "outside-linked-file.txt"
    outside.write_text("outside", encoding="utf-8")
    link = tmp_path / "link.txt"
    link.symlink_to(outside)

    try:
        with pytest.raises(TaskFileAccessError):
            resolve_task_file_path(str(link), str(tmp_path))
    finally:
        outside.unlink(missing_ok=True)


def test_resolve_task_file_path_rejects_directory(tmp_path):
    with pytest.raises(IsADirectoryError):
        resolve_task_file_path(str(tmp_path), str(tmp_path))
