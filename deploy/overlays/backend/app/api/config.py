"""Runtime application config exposed to the web UI."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.utils.config import settings


router = APIRouter(prefix="/config", tags=["config"])


class AppConfigResponse(BaseModel):
    max_upload_mb: int
    worker_count: int
    max_concurrent_tasks: int
    layout_page_parallelism: int
    task_timeout: int


@router.get("", response_model=AppConfigResponse)
async def get_app_config() -> AppConfigResponse:
    """Surface the handful of env-driven knobs the frontend needs at runtime."""

    return AppConfigResponse(
        max_upload_mb=settings.MAX_UPLOAD_MB,
        worker_count=settings.WORKER_COUNT,
        max_concurrent_tasks=settings.MAX_CONCURRENT_TASKS,
        layout_page_parallelism=settings.LAYOUT_PAGE_PARALLELISM,
        task_timeout=settings.TASK_TIMEOUT,
    )
