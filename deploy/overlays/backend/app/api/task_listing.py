from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api import task_context
from app.models.task import Task
from app.schemas.response import ApiResponse
from app.services.owner_service import OwnerSession, get_owner_session
from app.services.task_history_service import task_to_history_summary
from app.utils.logger import logger

router = APIRouter()


@router.get("/", response_model=ApiResponse[dict])
async def list_tasks(
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    owner: OwnerSession = Depends(get_owner_session),
):
    try:
        async with task_context.AsyncSessionLocal() as db:
            conditions = [Task.owner_hash == owner.owner_hash]
            if status:
                conditions.append(Task.status == status)
            result = await db.execute(
                select(Task)
                .where(*conditions)
                .order_by(Task.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
            tasks = list(result.scalars().all())

        return ApiResponse(
            success=True,
            data={
                "tasks": [task_to_history_summary(task) for task in tasks],
                "total": len(tasks),
                "limit": limit,
                "offset": offset,
            },
            message="Tasks retrieved successfully",
        )

    except Exception as exc:
        logger.error(f"Failed to list tasks: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list tasks: {str(exc)}",
        ) from exc
