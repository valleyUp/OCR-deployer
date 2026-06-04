from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.task_common import (
    get_task_file_info,
    get_task_info_or_404,
    read_task_result,
)
from app.schemas.response import ApiResponse
from app.services.formula_service import extract_formulas_from_layout
from app.services.owner_service import OwnerSession, get_owner_session
from app.utils.logger import logger

router = APIRouter()


@router.get("/{task_id}", response_model=ApiResponse[dict])
async def get_task_status(
    task_id: str,
    owner: OwnerSession = Depends(get_owner_session),
):
    try:
        task_info = await get_task_info_or_404(task_id, owner.owner_hash)

        result_data = read_task_result(task_info)
        if result_data:
            logger.info(f"Loaded result data for task {task_id}")

        started_at = task_info.get("started_at")
        completed_at = task_info.get("completed_at")
        execution_time = None
        if started_at and completed_at:
            execution_time = (completed_at - started_at).total_seconds()

        file_info = get_task_file_info(task_info)
        response_data = {
            "task_id": task_info.get("task_id"),
            "document_id": task_info.get("document_id"),
            "status": task_info.get("status"),
            "progress": task_info.get("progress"),
            "current_step": task_info.get("current_step"),
            "current_stage": task_info.get("current_step"),
            "created_at": (
                task_info.get("created_at").isoformat()
                if task_info.get("created_at")
                else None
            ),
            "started_at": started_at.isoformat() if started_at else None,
            "completed_at": completed_at.isoformat() if completed_at else None,
            "error_message": task_info.get("error_message"),
            "processing_mode": task_info.get("processing_mode"),
            "execution_time": execution_time,
            "priority": task_info.get("priority"),
            "retry_count": task_info.get("retry_count"),
            "worker_id": task_info.get("worker_id"),
            **file_info,
        }

        if result_data:
            metadata = result_data.get("metadata") or {}
            if task_info.get("processing_mode") and "processing_mode" not in metadata:
                metadata = {
                    **metadata,
                    "processing_mode": task_info.get("processing_mode"),
                }
            response_data["metadata"] = metadata
            response_data["full_markdown"] = result_data.get("full_markdown")
            response_data["layout"] = result_data.get("layout")
            response_data["formulas"] = result_data.get(
                "formulas"
            ) or extract_formulas_from_layout(
                result_data.get("layout"),
                task_id=task_id,
            )

        return ApiResponse(
            success=True,
            data=response_data,
            message="Task status retrieved successfully",
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to get task status: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get task status: {str(exc)}",
        ) from exc
