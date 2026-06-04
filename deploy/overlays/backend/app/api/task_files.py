from __future__ import annotations

from mimetypes import guess_type

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api import task_context
from app.api.task_common import get_owned_task_or_404
from app.schemas.response import ApiResponse
from app.services.owner_service import (
    OwnerSession,
    attach_owner_cookie,
    get_owner_session,
)
from app.services.task_file_service import (
    TaskFileAccessError,
    resolve_task_file_path,
    task_id_from_task_file_path,
)
from app.utils.logger import logger

router = APIRouter()


@router.get("/file")
async def read_file(
    path: str,
    owner: OwnerSession = Depends(get_owner_session),
):
    try:
        try:
            file_path = resolve_task_file_path(path, task_context.settings.OUTPUT_DIR)
        except TaskFileAccessError as exc:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"File path is outside task data directory: {path}",
            ) from exc
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {path}",
            ) from exc
        except IsADirectoryError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Path is not a file: {path}",
            ) from exc

        try:
            task_id = task_id_from_task_file_path(
                file_path, task_context.settings.OUTPUT_DIR
            )
        except TaskFileAccessError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Task file not found: {path}",
            ) from exc

        await get_owned_task_or_404(task_id, owner.owner_hash)

        mime_type, _ = guess_type(file_path.name)
        if mime_type is None:
            mime_type = "application/octet-stream"

        content = file_path.read_bytes()

        if mime_type.startswith("image/") or mime_type == "application/pdf":
            return attach_owner_cookie(
                Response(
                    content=content,
                    media_type=mime_type,
                    headers={
                        "Content-Disposition": f'inline; filename="{file_path.name}"'
                    },
                ),
                owner,
            )

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
    except Exception as exc:
        logger.error(f"Failed to read file: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(exc)}",
        ) from exc
