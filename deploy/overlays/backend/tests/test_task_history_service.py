from datetime import datetime, UTC
from types import SimpleNamespace

from app.services.task_history_service import task_to_history_summary


def test_task_to_history_summary_exposes_restore_fields(tmp_path):
    source = tmp_path / "source.pdf"
    result = tmp_path / "merged.json"
    source.write_bytes(b"%PDF-1.4\n")
    result.write_text("{}", encoding="utf-8")
    created_at = datetime(2026, 5, 12, 1, 2, 3, tzinfo=UTC)
    started_at = datetime(2026, 5, 12, 1, 2, 4, tzinfo=UTC)
    completed_at = datetime(2026, 5, 12, 1, 2, 9, tzinfo=UTC)

    summary = task_to_history_summary(
        SimpleNamespace(
            task_id="task-1",
            document_id="doc-1",
            status="completed",
            progress=100,
            current_step="merge",
            created_at=created_at,
            started_at=started_at,
            completed_at=completed_at,
            error_message=None,
            processing_mode="pipeline",
            priority=2,
            retry_count=0,
            original_filename="source.pdf",
            file_size=12,
            file_type="pdf",
            file_path=str(source),
            result_file_path=str(result),
            result={"metadata": {"total_pages": 3}},
            execution_time=None,
        )
    )

    assert summary["task_id"] == "task-1"
    assert summary["original_filename"] == "source.pdf"
    assert summary["source_file_path"] == str(source)
    assert summary["result_available"] is True
    assert summary["execution_time"] == 5
    assert summary["total_pages"] == 3
    assert summary["created_at"] == "2026-05-12T01:02:03+00:00"
