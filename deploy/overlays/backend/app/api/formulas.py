"""Formula rendering API."""

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.services.formula_service import FormulaRenderError, render_formula_bytes
from app.utils.logger import logger


router = APIRouter(prefix="/formulas", tags=["formulas"])


class FormulaRenderRequest(BaseModel):
    latex: str = Field(..., min_length=1, description="LaTeX source")
    format: str = Field("latex", description="latex, mathml, svg, png, or unicodemath")


@router.post("/render")
async def render_formula(payload: FormulaRenderRequest):
    """
    Render a single formula to LaTeX, MathML, SVG, PNG, or UnicodeMath.
    """
    try:
        content, media_type, extension = render_formula_bytes(
            payload.latex,
            payload.format,
        )
        return Response(
            content=content,
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="formula.{extension}"'
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except FormulaRenderError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )
    except Exception as exc:
        logger.error(f"Failed to render formula: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to render formula: {str(exc)}",
        )
