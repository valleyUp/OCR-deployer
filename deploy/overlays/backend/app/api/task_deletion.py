from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api import task_context
from app.api.task_common import delete_task_and_files
from app.models.task import Task
from app.schemas.response import ApiResponse
from app.services.owner_service import OwnerSession, get_owner_session
from app.utils.logger import logger

router = APIRouter()


@router.delete("/{task_id}", response_model=ApiResponse[dict])
async def delete_task(
    task_id: str,
    owner: OwnerSession = Depends(get_owner_session),
):
    try:
        async with task_context.AsyncSessionLocal() as db:
            result = await db.execute(
                select(Task).where(
                    Task.task_id == task_id,
                    Task.owner_hash == owner.owner_hash,
                )
            )
            task = result.scalar_one_or_none()
            if not task:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Task not found: {task_id}",
                )

            await delete_task_and_files(db, task)
            await db.commit()

        return ApiResponse(
            success=True,
            data={
                "task_id": task_id,
                "deleted": True,
            },
            message="Task deleted successfully",
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to delete task: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete task: {str(exc)}",
        ) from exc


@router.delete("/", response_model=ApiResponse[dict])
async def delete_all_tasks(owner: OwnerSession = Depends(get_owner_session)):
    try:
        async with task_context.AsyncSessionLocal() as db:
            result = await db.execute(
                select(Task).where(Task.owner_hash == owner.owner_hash)
            )
            tasks = list(result.scalars().all())
            for task in tasks:
                await delete_task_and_files(db, task)
            await db.commit()

        return ApiResponse(
            success=True,
            data={"deleted": len(tasks)},
            message="Tasks deleted successfully",
        )

    except Exception as exc:
        logger.error(f"Failed to delete tasks: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete tasks: {str(exc)}",
        ) from exc
