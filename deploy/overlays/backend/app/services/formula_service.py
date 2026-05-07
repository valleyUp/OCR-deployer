"""Formula extraction, rendering, and export helpers."""

from __future__ import annotations

import html
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

from PIL import Image, ImageDraw

try:
    from app.utils.config import settings
except Exception:  # pragma: no cover - lets lightweight unit tests import this file
    settings = None  # type: ignore


FORMULA_LAYOUT_TYPES = {
    "formula",
    "formula_number",
    "equation",
    "isolated_formula",
    "inline_formula",
}
FORMULA_FORMATS = {"latex", "tex", "mathml", "mml", "png"}
MATH_PATTERN = re.compile(
    r"(\$\$.*?\$\$|\\\[.*?\\\]|\\\(.*?\\\)|(?<!\$)\$[^$]+\$(?!\$)|\\begin\{[^}]+\}.*?\\end\{[^}]+\})",
    re.DOTALL,
)


class FormulaRenderError(ValueError):
    """Raised when a formula cannot be rendered."""


def normalize_formula_format(value: str) -> str:
    fmt = value.strip().lower()
    if fmt == "tex":
        return "latex"
    if fmt == "mml":
        return "mathml"
    if fmt not in {"latex", "mathml", "png"}:
        raise ValueError(f"Unsupported formula format: {value}")
    return fmt


def parse_formula_formats(value: str | Sequence[str] | None) -> List[str]:
    if value is None:
        return ["latex"]
    if isinstance(value, str):
        raw_formats = [item.strip() for item in value.split(",")]
    else:
        raw_formats = [str(item).strip() for item in value]

    formats: List[str] = []
    for raw in raw_formats:
        if not raw:
            continue
        fmt = normalize_formula_format(raw)
        if fmt not in formats:
            formats.append(fmt)
    return formats or ["latex"]


def normalize_latex(value: Any) -> str:
    text = "" if value is None else str(value).strip()
    if not text:
        return ""

    wrappers = [
        ("$$", "$$"),
        (r"\[", r"\]"),
        (r"\(", r"\)"),
        ("$", "$"),
    ]
    changed = True
    while changed:
        changed = False
        for left, right in wrappers:
            if text.startswith(left) and text.endswith(right) and len(text) >= len(left) + len(right):
                text = text[len(left) : len(text) - len(right)].strip()
                changed = True
    return text


def validate_latex_source(latex: str) -> None:
    depth = 0
    escaped = False
    for char in latex:
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth < 0:
                raise FormulaRenderError("Invalid LaTeX: unbalanced braces")
    if depth != 0:
        raise FormulaRenderError("Invalid LaTeX: unbalanced braces")


def extract_latex_candidates(content: Any) -> List[str]:
    text = "" if content is None else str(content)
    candidates = [normalize_latex(match.group(0)) for match in MATH_PATTERN.finditer(text)]
    candidates = [item for item in candidates if item]
    return candidates or [normalize_latex(text)]


def looks_like_formula(layout_type: Any, content: Any) -> bool:
    label = str(layout_type or "").strip().lower()
    if label in FORMULA_LAYOUT_TYPES or "formula" in label:
        return True

    text = "" if content is None else str(content)
    if not text.strip():
        return False
    if MATH_PATTERN.search(text):
        return True
    return bool(re.search(r"\\(frac|sum|int|sqrt|begin|alpha|beta|gamma|mathrm|tag)\b", text))


def make_formula_id(page_index: int, block_id: int | str | None, ordinal: int) -> str:
    block_part = str(block_id if block_id is not None else ordinal).replace("/", "-")
    return f"formula-p{page_index:04d}-b{block_part}"


def build_formula_entry(
    *,
    task_id: str | None,
    block: Dict[str, Any],
    latex: str,
    ordinal: int,
) -> Dict[str, Any]:
    page_index = int(block.get("page_index") or 1)
    block_id = block.get("block_id") or block.get("index")
    formula_id = block.get("formula_id") or make_formula_id(page_index, block_id, ordinal)
    return {
        "formula_id": formula_id,
        "task_id": task_id,
        "block_id": block_id,
        "page_index": page_index,
        "bbox": block.get("bbox") or block.get("layout_box"),
        "layout_type": block.get("layout_type") or "formula",
        "latex": latex,
        "formula": {"latex": latex},
    }


def extract_formulas_from_layout(
    layout: Iterable[Dict[str, Any]] | None,
    task_id: str | None = None,
) -> List[Dict[str, Any]]:
    formulas: List[Dict[str, Any]] = []
    if not layout:
        return formulas

    for block in layout:
        if not isinstance(block, dict):
            continue
        embedded = block.get("formula") if isinstance(block.get("formula"), dict) else None
        explicit_latex = normalize_latex(embedded.get("latex")) if embedded else ""
        layout_type = block.get("layout_type")
        content = block.get("block_content") or block.get("content")

        if explicit_latex:
            formulas.append(
                build_formula_entry(
                    task_id=task_id,
                    block=block,
                    latex=explicit_latex,
                    ordinal=len(formulas) + 1,
                )
            )
            continue

        if not looks_like_formula(layout_type, content):
            continue

        for latex in extract_latex_candidates(content):
            if not latex:
                continue
            formulas.append(
                build_formula_entry(
                    task_id=task_id,
                    block=block,
                    latex=latex,
                    ordinal=len(formulas) + 1,
                )
            )

    return formulas


def load_result_file(result_file_path: str | os.PathLike[str]) -> Dict[str, Any]:
    path = Path(result_file_path)
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError("Task result is not a JSON object")
    return data


def _renderer_script() -> str:
    if settings is not None:
        return str(getattr(settings, "FORMULA_RENDERER_SCRIPT", ""))
    return os.getenv("FORMULA_RENDERER_SCRIPT", "/opt/formula-renderer/render-formula.cjs")


def _render_timeout() -> int:
    if settings is not None:
        return int(getattr(settings, "FORMULA_RENDER_TIMEOUT", 20))
    return int(os.getenv("FORMULA_RENDER_TIMEOUT", "20"))


def render_mathjax_markup(latex: str, format: str) -> str:
    renderer = _renderer_script()
    if not renderer or not Path(renderer).exists():
        raise FormulaRenderError("Formula renderer is not installed")

    payload = json.dumps({"latex": latex, "format": format})
    try:
        result = subprocess.run(
            ["node", renderer],
            input=payload,
            text=True,
            capture_output=True,
            timeout=_render_timeout(),
            check=True,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        detail = getattr(exc, "stderr", "") or str(exc)
        raise FormulaRenderError(f"Formula render failed: {detail}") from exc

    output = result.stdout.strip()
    if not output:
        raise FormulaRenderError("Formula renderer returned empty output")
    return output


def fallback_mathml(latex: str) -> str:
    escaped = html.escape(latex)
    return f'<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext>{escaped}</mtext></math>'


def fallback_png(latex: str) -> bytes:
    text = latex[:180] or "formula"
    width = max(360, min(1400, 18 * len(text)))
    height = 96
    image = Image.new("RGBA", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.text((16, 32), text, fill=(20, 24, 32, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def svg_to_png(svg_markup: str) -> bytes:
    converter = shutil.which("rsvg-convert")
    if not converter:
        raise FormulaRenderError("rsvg-convert is not installed")

    with tempfile.TemporaryDirectory() as tmp_dir:
        svg_path = Path(tmp_dir) / "formula.svg"
        png_path = Path(tmp_dir) / "formula.png"
        svg_path.write_text(svg_markup, encoding="utf-8")
        subprocess.run(
            [converter, "-f", "png", "-o", str(png_path), str(svg_path)],
            capture_output=True,
            text=True,
            timeout=_render_timeout(),
            check=True,
        )
        return png_path.read_bytes()


def render_formula_bytes(latex: str, format: str) -> tuple[bytes, str, str]:
    normalized_latex = normalize_latex(latex)
    if not normalized_latex:
        raise FormulaRenderError("latex is required")
    validate_latex_source(normalized_latex)

    fmt = normalize_formula_format(format)
    if fmt == "latex":
        return normalized_latex.encode("utf-8"), "application/x-tex; charset=utf-8", "tex"

    if fmt == "mathml":
        try:
            mathml = render_mathjax_markup(normalized_latex, "mathml")
        except FormulaRenderError:
            mathml = fallback_mathml(normalized_latex)
        return mathml.encode("utf-8"), "application/mathml+xml; charset=utf-8", "mml"

    try:
        svg_markup = render_mathjax_markup(normalized_latex, "svg")
        png = svg_to_png(svg_markup)
    except FormulaRenderError:
        png = fallback_png(normalized_latex)
    return png, "image/png", "png"


def build_formulas_zip(formulas: List[Dict[str, Any]], formats: Sequence[str]) -> bytes:
    normalized_formats = parse_formula_formats(formats)
    buffer = io.BytesIO()
    manifest = {
        "count": len(formulas),
        "formats": normalized_formats,
        "formulas": formulas,
    }

    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for formula in formulas:
            formula_id = str(formula.get("formula_id") or "formula")
            latex = str(formula.get("latex") or formula.get("formula", {}).get("latex") or "")
            for fmt in normalized_formats:
                content, _, extension = render_formula_bytes(latex, fmt)
                archive.writestr(f"{formula_id}.{extension}", content)

    return buffer.getvalue()
