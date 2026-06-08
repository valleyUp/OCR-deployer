from __future__ import annotations

import uuid
from datetime import UTC, datetime
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api import task_context
from app.api.task_common import FORMULA_MODE_PROMPT, SUPPORTED_PROCESSING_MODES
from app.core.task_manager import get_task_manager
from app.models.task import Task, TaskStatus
from app.schemas.response import ApiResponse, TaskData
from app.services.owner_service import OwnerSession, get_owner_session
from app.utils.logger import logger
from app.utils.upload_file_manager import file_upload_handler

router = APIRouter()


def _configured_allowed_custom_hosts() -> set[str]:
    raw = getattr(task_context.settings, "CUSTOM_OCR_ALLOWED_HOSTS", "")
    return {host.strip().lower() for host in raw.split(",") if host.strip()}


def _is_local_or_private_host(hostname: str) -> bool:
    host = hostname.strip().lower().rstrip(".")
    if host in {"localhost", "0.0.0.0"}:
        return True

    try:
        address = ip_address(host)
    except ValueError:
        return False
    return (
        address.is_loopback
        or address.is_private
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
    )


def _validate_custom_url(custom_url: str | None) -> dict[str, str] | None:
    if custom_url is None or not custom_url.strip():
        return None

    if not getattr(task_context.settings, "ALLOW_CUSTOM_OCR_URLS", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="custom_url is disabled for this deployment",
        )

    parsed = urlparse(custom_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="custom_url must be an http(s) URL with a host",
        )

    hostname = parsed.hostname.lower()
    allowed_hosts = _configured_allowed_custom_hosts()
    if allowed_hosts and hostname not in allowed_hosts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="custom_url host is not allowed",
        )
    if not allowed_hosts and _is_local_or_private_host(hostname):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="custom_url cannot target local or private addresses",
        )

    return {"custom_url": custom_url.strip()}


@router.post(
    "/upload",
    response_model=ApiResponse[TaskData],
    status_code=status.HTTP_201_CREATED,
)
async def submit_task(
    file: UploadFile = File(..., description="要处理的文件"),
    processing_mode: str = Form("pipeline"),
    priority: int = Form(2, description="1=低,2=正常,3=高,4=紧急"),
    custom_url: str | None = Form(None, description=""),
    output_format: str = Form("markdown"),
    owner: OwnerSession = Depends(get_owner_session),
):
    try:
        if processing_mode not in SUPPORTED_PROCESSING_MODES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Unsupported processing_mode: {processing_mode}. "
                    f"Available modes: {sorted(SUPPORTED_PROCESSING_MODES)}"
                ),
            )

        document_id = str(uuid.uuid4())
        task_id = str(uuid.uuid4())

        parsed_ocr_config = _validate_custom_url(custom_url)
        if processing_mode == "formula":
            parsed_ocr_config = parsed_ocr_config or {}
            parsed_ocr_config.setdefault("prompt", FORMULA_MODE_PROMPT)

        save_dir = str(Path(task_context.settings.OUTPUT_DIR) / task_id)
        saved_path = await file_upload_handler.save_to_path(
            file=file,
            filename=file.filename,
            upload_dir=save_dir,
        )
        saved_path_obj = Path(saved_path)
        file_size = saved_path_obj.stat().st_size
        file_type = saved_path_obj.suffix.lstrip(".").lower()

        task_manager = get_task_manager()
        if not task_manager.is_running:
            raise RuntimeError("TaskManager is not running")

        async with task_context.AsyncSessionLocal() as db:
            db.add(
                Task(
                    task_id=task_id,
                    owner_hash=owner.owner_hash,
                    document_id=document_id,
                    original_filename=file.filename,
                    file_type=file_type,
                    file_size=file_size,
                    file_path=str(saved_path_obj),
                    processing_mode=processing_mode,
                    priority=priority,
                    ocr_config=parsed_ocr_config or {},
                    output_format=output_format,
                    status=TaskStatus.PENDING,
                    progress=0.0,
                )
            )
            await db.commit()

        return ApiResponse(
            success=True,
            data={
                "task_id": task_id,
                "document_id": document_id,
                "status": "pending",
                "processing_mode": processing_mode,
                "priority": priority,
                "created_at": datetime.now(UTC).isoformat(),
            },
            message="Task submitted successfully",
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to submit task: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to submit task: {str(exc)}",
        ) from exc
