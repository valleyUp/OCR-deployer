from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.services.formulas.fallbacks import fallback_mathml, fallback_unicodemath
from app.services.formulas.formats import (
    normalize_formula_format,
    normalize_latex,
    validate_latex_source,
    validate_texlive_source,
    wrap_texlive_formula,
)
from app.services.formulas.types import TEXLIVE_PACKAGES, FormulaRenderError

try:
    from app.utils.config import settings
except (ImportError, RuntimeError):
    settings = None


def _renderer_script() -> str:
    if settings is not None:
        return str(getattr(settings, "FORMULA_RENDERER_SCRIPT", ""))
    return os.getenv(
        "FORMULA_RENDERER_SCRIPT", "/opt/formula-renderer/render-formula.cjs"
    )


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


def render_texlive_svg(latex: str) -> str:
    latex_bin = shutil.which("latex")
    dvisvgm_bin = shutil.which("dvisvgm")
    if not latex_bin or not dvisvgm_bin:
        raise FormulaRenderError("TeX Live renderer is not installed")

    validate_texlive_source(latex)
    package_lines = "\n".join(
        f"\\usepackage{{{package}}}" for package in TEXLIVE_PACKAGES
    )
    document = f"""\\documentclass[preview,border=2pt]{{standalone}}
\\usepackage[utf8]{{inputenc}}
\\usepackage[T1]{{fontenc}}
{package_lines}
\\begin{{document}}
{wrap_texlive_formula(latex)}
\\end{{document}}
"""

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        tex_path = tmp_path / "formula.tex"
        dvi_path = tmp_path / "formula.dvi"
        svg_path = tmp_path / "formula.svg"
        tex_path.write_text(document, encoding="utf-8")

        try:
            subprocess.run(
                [
                    latex_bin,
                    "-interaction=nonstopmode",
                    "-halt-on-error",
                    "-no-shell-escape",
                    tex_path.name,
                ],
                cwd=tmp_path,
                capture_output=True,
                text=True,
                timeout=_render_timeout(),
                check=True,
            )
        except (subprocess.SubprocessError, OSError) as exc:
            detail = (
                getattr(exc, "stderr", "") or getattr(exc, "stdout", "") or str(exc)
            )
            raise FormulaRenderError(f"LaTeX render failed: {detail}") from exc

        if not dvi_path.exists():
            raise FormulaRenderError("LaTeX renderer did not produce DVI output")

        try:
            subprocess.run(
                [
                    dvisvgm_bin,
                    "--no-fonts",
                    "--exact",
                    "--bbox=min",
                    "-o",
                    svg_path.name,
                    dvi_path.name,
                ],
                cwd=tmp_path,
                capture_output=True,
                text=True,
                timeout=_render_timeout(),
                check=True,
            )
        except (subprocess.SubprocessError, OSError) as exc:
            detail = (
                getattr(exc, "stderr", "") or getattr(exc, "stdout", "") or str(exc)
            )
            raise FormulaRenderError(f"DVI to SVG conversion failed: {detail}") from exc

        if not svg_path.exists():
            raise FormulaRenderError("dvisvgm did not produce SVG output")
        return extract_svg_markup(svg_path.read_text(encoding="utf-8"))


def extract_svg_markup(markup: str) -> str:
    match = re.search(r"(<svg[\s\S]*?</svg>)", markup.strip())
    return match.group(1) if match else markup


def svg_to_png(svg_markup: str) -> bytes:
    converter = shutil.which("rsvg-convert")
    if not converter:
        raise FormulaRenderError("rsvg-convert is not installed")

    with tempfile.TemporaryDirectory() as tmp_dir:
        svg_path = Path(tmp_dir) / "formula.svg"
        png_path = Path(tmp_dir) / "formula.png"
        svg_path.write_text(extract_svg_markup(svg_markup), encoding="utf-8")
        try:
            subprocess.run(
                [converter, "-f", "png", "-o", str(png_path), str(svg_path)],
                capture_output=True,
                text=True,
                timeout=_render_timeout(),
                check=True,
            )
        except (subprocess.SubprocessError, OSError) as exc:
            detail = getattr(exc, "stderr", "") or str(exc)
            raise FormulaRenderError(f"SVG to PNG conversion failed: {detail}") from exc
        return png_path.read_bytes()


def render_formula_bytes(latex: str, format: str) -> tuple[bytes, str, str]:
    normalized_latex = normalize_latex(latex)
    if not normalized_latex:
        raise FormulaRenderError("latex is required")
    validate_latex_source(normalized_latex)

    fmt = normalize_formula_format(format)
    if fmt == "latex":
        return (
            normalized_latex.encode("utf-8"),
            "application/x-tex; charset=utf-8",
            "tex",
        )

    if fmt == "mathml":
        try:
            mathml = render_mathjax_markup(normalized_latex, "mathml")
        except FormulaRenderError:
            mathml = fallback_mathml(normalized_latex)
        return mathml.encode("utf-8"), "application/mathml+xml; charset=utf-8", "mml"

    if fmt == "unicodemath":
        try:
            unicode_math = render_mathjax_markup(normalized_latex, "unicodemath")
        except FormulaRenderError:
            unicode_math = fallback_unicodemath(normalized_latex)
        return unicode_math.encode("utf-8"), "text/plain; charset=utf-8", "txt"

    svg_markup = render_texlive_svg(normalized_latex)
    if fmt == "svg":
        return svg_markup.encode("utf-8"), "image/svg+xml; charset=utf-8", "svg"

    png = svg_to_png(svg_markup)
    return png, "image/png", "png"
