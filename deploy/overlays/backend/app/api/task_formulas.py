from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.task_common import get_task_info_or_404, read_task_result
from app.schemas.response import ApiResponse
from app.services.formula_service import (
    build_formulas_zip,
    extract_formulas_from_layout,
    parse_formula_formats,
)
from app.services.owner_service import OwnerSession, get_owner_session
from app.utils.logger import logger

router = APIRouter()


@router.get("/{task_id}/formulas", response_model=ApiResponse[dict])
async def list_task_formulas(
    task_id: str,
    owner: OwnerSession = Depends(get_owner_session),
):
    try:
        task_info = await get_task_info_or_404(task_id, owner.owner_hash)
        result_data = read_task_result(task_info)
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
    except Exception as exc:
        logger.error(f"Failed to list task formulas: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list task formulas: {str(exc)}",
        ) from exc


@router.get("/{task_id}/formulas/export")
async def export_task_formulas(
    task_id: str,
    formats: str = "latex,mathml,png",
    owner: OwnerSession = Depends(get_owner_session),
):
    try:
        task_info = await get_task_info_or_404(task_id, owner.owner_hash)
        result_data = read_task_result(task_info)
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
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to export task formulas: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export task formulas: {str(exc)}",
        ) from exc
