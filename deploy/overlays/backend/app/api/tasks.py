import sys
from types import ModuleType

from fastapi import APIRouter

from app.api import task_context
from app.api.task_common import (
    FORMULA_MODE_PROMPT,
    SUPPORTED_PROCESSING_MODES,
)
from app.api.task_common import delete_task_and_files as _delete_task_and_files
from app.api.task_common import get_owned_task_or_404 as _get_owned_task_or_404
from app.api.task_common import get_task_file_info as _get_task_file_info
from app.api.task_common import get_task_info_or_404 as _get_task_info_or_404
from app.api.task_common import read_task_result as _read_task_result
from app.api.task_common import task_to_status_info as _task_to_status_info
from app.api.task_deletion import delete_all_tasks, delete_task
from app.api.task_deletion import router as deletion_router
from app.api.task_files import read_file
from app.api.task_files import router as files_router
from app.api.task_formulas import export_task_formulas, list_task_formulas
from app.api.task_formulas import router as formulas_router
from app.api.task_listing import list_tasks
from app.api.task_listing import router as listing_router
from app.api.task_status import get_task_status
from app.api.task_status import router as status_router
from app.api.task_upload import router as upload_router
from app.api.task_upload import submit_task

router = APIRouter(prefix="/tasks", tags=["tasks"])
router.include_router(upload_router)
router.include_router(files_router)
router.include_router(formulas_router)
router.include_router(deletion_router)
router.include_router(listing_router)
router.include_router(status_router)

settings = task_context.settings
AsyncSessionLocal = task_context.AsyncSessionLocal


class _TasksModule(ModuleType):
    def __setattr__(self, name: str, value: object) -> None:
        if name == "AsyncSessionLocal":
            task_context.AsyncSessionLocal = value
        elif name == "settings":
            task_context.settings = value
        super().__setattr__(name, value)


sys.modules[__name__].__class__ = _TasksModule

__all__ = [
    "AsyncSessionLocal",
    "FORMULA_MODE_PROMPT",
    "SUPPORTED_PROCESSING_MODES",
    "_delete_task_and_files",
    "_get_owned_task_or_404",
    "_get_task_file_info",
    "_get_task_info_or_404",
    "_read_task_result",
    "_task_to_status_info",
    "delete_all_tasks",
    "delete_task",
    "export_task_formulas",
    "get_task_status",
    "list_task_formulas",
    "list_tasks",
    "read_file",
    "router",
    "settings",
    "submit_task",
]
