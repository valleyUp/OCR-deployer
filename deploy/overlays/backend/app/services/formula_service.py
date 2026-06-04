from collections.abc import Callable, Mapping, Sequence
from typing import ParamSpec, TypeVar

from app.services.formulas import (
    BLOCKED_TEX_COMMAND_PATTERN,
    DISPLAY_ENV_PATTERN,
    DISPLAY_FORMULA_CONTENT_LAYOUT_TYPES,
    DISPLAY_MATH_PATTERN,
    FORMULA_CONTENT_LAYOUT_TYPES,
    FORMULA_FORMATS,
    FORMULA_LAYOUT_TYPES,
    FORMULA_NUMBER_LAYOUT_TYPES,
    INLINE_FORMULA_LAYOUT_TYPES,
    INLINE_MATH_FULL_PATTERN,
    MATH_PATTERN,
    TEXLIVE_PACKAGES,
    FormulaRenderError,
    extract_formulas_from_layout,
    extract_latex_candidates,
    extract_svg_markup,
    fallback_mathml,
    fallback_png,
    fallback_unicodemath,
    is_display_formula_layout,
    is_display_formula_only_content,
    is_explicit_formula_layout,
    is_formula_number_layout,
    is_formula_only_content,
    load_result_file,
    looks_like_formula,
    make_formula_id,
    normalize_formula_format,
    normalize_latex,
    parse_formula_formats,
)
from app.services.formulas import rendering as _rendering
from app.services.formulas import (
    should_keep_formula_mode_block,
    svg_to_png,
    validate_latex_source,
    validate_texlive_source,
    wrap_texlive_formula,
)
from app.services.formulas.archive import build_formulas_zip as _build_formulas_zip
from app.services.formulas.rendering import _render_timeout, _renderer_script

P = ParamSpec("P")
T = TypeVar("T")


def _with_legacy_renderer(function: Callable[P, T], *args: P.args) -> T:
    previous_script = _rendering._renderer_script
    previous_timeout = _rendering._render_timeout
    _rendering._renderer_script = _renderer_script
    _rendering._render_timeout = _render_timeout
    try:
        return function(*args)
    finally:
        _rendering._renderer_script = previous_script
        _rendering._render_timeout = previous_timeout


def render_mathjax_markup(latex: str, format: str) -> str:
    return _with_legacy_renderer(_rendering.render_mathjax_markup, latex, format)


def render_texlive_svg(latex: str) -> str:
    return _with_legacy_renderer(_rendering.render_texlive_svg, latex)


def render_formula_bytes(latex: str, format: str) -> tuple[bytes, str, str]:
    return _with_legacy_renderer(_rendering.render_formula_bytes, latex, format)


def build_formulas_zip(
    formulas: list[Mapping[str, object]], formats: Sequence[str]
) -> bytes:
    return _with_legacy_renderer(_build_formulas_zip, formulas, formats)


__all__ = [
    "BLOCKED_TEX_COMMAND_PATTERN",
    "DISPLAY_ENV_PATTERN",
    "DISPLAY_FORMULA_CONTENT_LAYOUT_TYPES",
    "DISPLAY_MATH_PATTERN",
    "FORMULA_CONTENT_LAYOUT_TYPES",
    "FORMULA_FORMATS",
    "FORMULA_LAYOUT_TYPES",
    "FORMULA_NUMBER_LAYOUT_TYPES",
    "FormulaRenderError",
    "INLINE_FORMULA_LAYOUT_TYPES",
    "INLINE_MATH_FULL_PATTERN",
    "MATH_PATTERN",
    "TEXLIVE_PACKAGES",
    "_render_timeout",
    "_renderer_script",
    "build_formulas_zip",
    "extract_formulas_from_layout",
    "extract_latex_candidates",
    "extract_svg_markup",
    "fallback_mathml",
    "fallback_png",
    "fallback_unicodemath",
    "is_display_formula_layout",
    "is_display_formula_only_content",
    "is_explicit_formula_layout",
    "is_formula_number_layout",
    "is_formula_only_content",
    "load_result_file",
    "looks_like_formula",
    "make_formula_id",
    "normalize_formula_format",
    "normalize_latex",
    "parse_formula_formats",
    "render_formula_bytes",
    "render_mathjax_markup",
    "render_texlive_svg",
    "should_keep_formula_mode_block",
    "svg_to_png",
    "validate_latex_source",
    "validate_texlive_source",
    "wrap_texlive_formula",
]
