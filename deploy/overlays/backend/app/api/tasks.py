"""
任务相关API
"""

import uuid
from pathlib import Path
from typing import Optional
from datetime import datetime, UTC

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Response
from mimetypes import guess_type
from sqlalchemy import select

from app.schemas.response import ApiResponse, TaskData
from app.core.task_manager import get_task_manager
from app.db.database import AsyncSessionLocal
from app.models.task import Task, TaskStatus
from app.utils.logger import logger
from app.utils.upload_file_manager import file_upload_handler
from app.utils.config import settings
from app.services.owner_service import OwnerSession, attach_owner_cookie, get_owner_session
from app.services.task_cleanup_service import delete_task_files
from app.services.formula_service import (
    build_formulas_zip,
    extract_formulas_from_layout,
    load_result_file,
    parse_formula_formats,
)
from app.services.task_file_service import (
    TaskFileAccessError,
    resolve_task_file_path,
    task_id_from_task_file_path,
)
from app.services.task_history_service import task_to_history_summary


router = APIRouter(prefix="/tasks", tags=["tasks"])
SUPPORTED_PROCESSING_MODES = {"pipeline", "formula"}
FORMULA_MODE_PROMPT = (
    "Extract only display or block mathematical equations that occupy their own "
    "line or a standalone formula region. Return LaTeX for those display "
    "equations only. Do not extract inline mathematical symbols or formulas "
    "embedded inside prose paragraphs. Ignore standalone formula numbers unless "
    "they are attached to a display equation."
)


async def _get_owned_task_or_404(task_id: str, owner_hash: str) -> Task:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Task).where(Task.task_id == task_id, Task.owner_hash == owner_hash)
        )
        task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task not found: {task_id}",
        )
    return task


def _task_to_status_info(task: Task) -> dict:
    return {
        "task_id": task.task_id,
        "document_id": task.document_id,
        "status": task.status,
        "progress": task.progress,
        "current_step": task.current_step,
        "created_at": task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
        "error_message": task.error_message,
        "result_file_path": task.result_file_path,
        "processing_mode": task.processing_mode,
        "priority": task.priority,
        "retry_count": task.retry_count,
        "worker_id": task.worker_id,
        "original_filename": task.original_filename,
        "source_file_path": task.file_path,
    }


async def _get_task_info_or_404(task_id: str, owner_hash: str) -> dict:
    task = await _get_owned_task_or_404(task_id, owner_hash)
    return _task_to_status_info(task)


def _read_task_result(task_info: dict) -> dict:
    result_file_path = task_info.get("result_file_path")
    if not result_file_path:
        return {}

    result_path = Path(result_file_path)
    if not result_path.exists():
        logger.warning(f"Result file not found: {result_file_path}")
        return {}

    try:
        return load_result_file(result_path)
    except Exception as exc:
        logger.warning(f"Failed to read result file {result_file_path}: {exc}")
        return {}


def _get_task_file_info(task_info: dict) -> dict:
    return {
        "original_filename": task_info.get("original_filename"),
        "source_file_path": task_info.get("source_file_path"),
    }


async def _delete_task_and_files(db, task: Task) -> None:
    if task.status in {TaskStatus.PENDING, TaskStatus.PROCESSING}:
        task.status = TaskStatus.CANCELLED
        task.completed_at = datetime.now(UTC)

    try:
        delete_task_files(task.task_id, settings.OUTPUT_DIR)
    except FileNotFoundError:
        pass

    await db.delete(task)


@router.post(
    "/upload",
    response_model=ApiResponse[TaskData],
    status_code=status.HTTP_201_CREATED,
)
async def submit_task(
    file: UploadFile = File(..., description="要处理的文件"),
    processing_mode: str = Form("pipeline"),
    priority: int = Form(2, description="1=低,2=正常,3=高,4=紧急"),
    custom_url : str = Form(None, description=""),
    output_format: str = Form("markdown"),
    owner: OwnerSession = Depends(get_owner_session),
):
    """
    提交新任务

    - **file**: 上传文件
    - **processing_mode**: 处理模式，默认pipeline
    - **priority**: 优先级 (1=低, 2=正常, 3=高, 4=紧急)
    - **ocr_config**: OCR配置（JSON字符串，可选）
    - **output_format**: 输出格式，默认markdown
    - **retry_config**: 重试配置（JSON字符串，可选）
    """
    try:
        if processing_mode not in SUPPORTED_PROCESSING_MODES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Unsupported processing_mode: {processing_mode}. "
                    f"Available modes: {sorted(SUPPORTED_PROCESSING_MODES)}"
                ),
            )

        # 生成document_id
        document_id = str(uuid.uuid4())
        task_id = str(uuid.uuid4())

        parsed_ocr_config = None
        # 解析配置
        if custom_url is not None :
            parsed_ocr_config = {"custom_url":custom_url}
        if processing_mode == "formula":
            parsed_ocr_config = parsed_ocr_config or {}
            parsed_ocr_config.setdefault(
                "prompt",
                FORMULA_MODE_PROMPT,
            )

        # 保存文件
        save_dir = str(Path(settings.OUTPUT_DIR) / task_id)
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

        async with AsyncSessionLocal() as db:
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
    except Exception as e:
        logger.error(f"Failed to submit task: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to submit task: {str(e)}",
        )


@router.get("/file")
async def read_file(
    path: str,
    owner: OwnerSession = Depends(get_owner_session),
):
    """
    读取指定路径的文件内容

    对于图片或 PDF 文件，直接返回文件数据
    对于其他文件，返回JSON格式的文件信息

    - **path**: 文件路径
    """
    try:
        try:
            file_path = resolve_task_file_path(path, settings.OUTPUT_DIR)
        except TaskFileAccessError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"File path is outside task data directory: {path}",
            )
        except FileNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {path}",
            )
        except IsADirectoryError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Path is not a file: {path}",
            )

        try:
            task_id = task_id_from_task_file_path(file_path, settings.OUTPUT_DIR)
        except TaskFileAccessError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Task file not found: {path}",
            )

        await _get_owned_task_or_404(task_id, owner.owner_hash)

        # 获取文件MIME类型
        mime_type, _ = guess_type(file_path.name)
        if mime_type is None:
            mime_type = "application/octet-stream"

        # 读取文件内容
        with open(file_path, "rb") as f:
            content = f.read()

        # 预览器需要直接加载图片和 PDF 的二进制内容。
        if mime_type.startswith("image/") or mime_type == "application/pdf":
            return attach_owner_cookie(Response(
                content=content,
                media_type=mime_type,
                headers={
                    "Content-Disposition": f"inline; filename=\"{file_path.name}\""
                }
            ), owner)

        # 其他文件类型，返回JSON格式
        try:
            text_content = content.decode("utf-8")
        except UnicodeDecodeError:
            text_content = "(binary file)"

        return ApiResponse(
            success=True,
            data={
                "path": str(file_path.absolute()),
                "filename": file_path.name,
                "size": file_path.stat().st_size,
                "mime_type": mime_type,
                "content": text_content,
            },
            message="File read successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to read file: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(e)}",
        )


@router.get("/{task_id}", response_model=ApiResponse[dict])
async def get_task_status(
    task_id: str,
    owner: OwnerSession = Depends(get_owner_session),
):
    """
    获取任务状态

    - **task_id**: 任务ID
    """
    try:
        task_info = await _get_task_info_or_404(task_id, owner.owner_hash)

        # 如果有 result_file_path，读取并合并内容
        result_data = _read_task_result(task_info)
        if result_data:
            logger.info(f"Loaded result data for task {task_id}")

        # 构建响应数据
        started_at = task_info.get("started_at")
        completed_at = task_info.get("completed_at")
        execution_time = None
        if started_at and completed_at:
            execution_time = (completed_at - started_at).total_seconds()

        file_info = _get_task_file_info(task_info)
        response_data = {
            "task_id": task_info.get("task_id"),
            "document_id": task_info.get("document_id"),
            "status": task_info.get("status"),
            "progress": task_info.get("progress"),
            "current_step": task_info.get("current_step"),
            "current_stage": task_info.get("current_step"),
            "created_at": task_info.get("created_at").isoformat() if task_info.get("created_at") else None,
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

        # 添加结果数据
        if result_data:
            metadata = result_data.get("metadata") or {}
            if task_info.get("processing_mode") and "processing_mode" not in metadata:
                metadata = {
                    **metadata,
                    "processing_mode": task_info.get("processing_mode"),
                }
            response_data["metadata"]= metadata
            response_data["full_markdown"] = result_data.get("full_markdown")
            response_data["layout"] = result_data.get("layout")
            response_data["formulas"] = result_data.get("formulas") or extract_formulas_from_layout(
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
    except Exception as e:
        logger.error(f"Failed to get task status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get task status: {str(e)}",
        )


@router.get("/{task_id}/formulas", response_model=ApiResponse[dict])
async def list_task_formulas(
    task_id: str,
    owner: OwnerSession = Depends(get_owner_session),
):
    """
    列出任务中的公式块

    - **task_id**: 任务ID
    """
    try:
        task_info = await _get_task_info_or_404(task_id, owner.owner_hash)
        result_data = _read_task_result(task_info)
        formulas = result_data.get("formulas") or extract_formulas_from_layout(
            result_data.get("layout"),
            task_id=task_id,
        )

        return ApiResponse(
            success=True,
            data={
                "task_id": task_id,
                "count": len(formulas),
                "formulas": formulas,
            },
            message="Task formulas retrieved successfully",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list task formulas: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list task formulas: {str(e)}",
        )


@router.get("/{task_id}/formulas/export")
async def export_task_formulas(
    task_id: str,
    formats: str = "latex,mathml,png",
    owner: OwnerSession = Depends(get_owner_session),
):
    """
    导出任务中的公式

    - **task_id**: 任务ID
    - **formats**: 逗号分隔格式，支持 latex,mathml,png
    """
    try:
        task_info = await _get_task_info_or_404(task_id, owner.owner_hash)
        result_data = _read_task_result(task_info)
        formulas = result_data.get("formulas") or extract_formulas_from_layout(
            result_data.get("layout"),
            task_id=task_id,
        )
        export_formats = parse_formula_formats(formats)
        archive = build_formulas_zip(formulas, export_formats)

        return Response(
            content=archive,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{task_id}-formulas.zip"'
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to export task formulas: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export task formulas: {str(e)}",
        )


@router.delete("/{task_id}", response_model=ApiResponse[dict])
async def delete_task(
    task_id: str,
    owner: OwnerSession = Depends(get_owner_session),
):
    """
    删除任务及其持久化文件

    - **task_id**: 任务ID
    """
    try:
        async with AsyncSessionLocal() as db:
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

            await _delete_task_and_files(db, task)
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
    except Exception as e:
        logger.error(f"Failed to delete task: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete task: {str(e)}",
        )


@router.delete("/", response_model=ApiResponse[dict])
async def delete_all_tasks(owner: OwnerSession = Depends(get_owner_session)):
    """删除当前匿名 owner 的所有任务及任务文件。"""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Task).where(Task.owner_hash == owner.owner_hash)
            )
            tasks = list(result.scalars().all())
            for task in tasks:
                await _delete_task_and_files(db, task)
            await db.commit()

        return ApiResponse(
            success=True,
            data={"deleted": len(tasks)},
            message="Tasks deleted successfully",
        )

    except Exception as e:
        logger.error(f"Failed to delete tasks: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete tasks: {str(e)}",
        )


@router.get("/", response_model=ApiResponse[dict])
async def list_tasks(
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    owner: OwnerSession = Depends(get_owner_session),
):
    """
    列出任务

    - **status**: 过滤状态 (pending, processing, completed, failed, cancelled)
    - **limit**: 返回数量限制
    - **offset**: 偏移量
    """
    try:
        async with AsyncSessionLocal() as db:
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

    except Exception as e:
        logger.error(f"Failed to list tasks: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list tasks: {str(e)}",
        )
