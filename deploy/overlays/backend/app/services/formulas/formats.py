from __future__ import annotations

from collections.abc import Sequence

from app.services.formulas.types import (
    BLOCKED_TEX_COMMAND_PATTERN,
    DISPLAY_ENV_PATTERN,
    FormulaRenderError,
)


def normalize_formula_format(value: str) -> str:
    fmt = value.strip().lower()
    if fmt == "tex":
        return "latex"
    if fmt == "mml":
        return "mathml"
    if fmt in {"um", "unicode", "unicodemath"}:
        return "unicodemath"
    if fmt not in {"latex", "mathml", "svg", "png", "unicodemath"}:
        raise ValueError(f"Unsupported formula format: {value}")
    return fmt


def parse_formula_formats(value: str | Sequence[str] | None) -> list[str]:
    if value is None:
        return ["latex"]
    if isinstance(value, str):
        raw_formats = [item.strip() for item in value.split(",")]
    else:
        raw_formats = [str(item).strip() for item in value]

    formats: list[str] = []
    for raw in raw_formats:
        if not raw:
            continue
        fmt = normalize_formula_format(raw)
        if fmt not in formats:
            formats.append(fmt)
    return formats or ["latex"]


def normalize_latex(value: object) -> str:
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
            if (
                text.startswith(left)
                and text.endswith(right)
                and len(text) >= len(left) + len(right)
            ):
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


def validate_texlive_source(latex: str) -> None:
    match = BLOCKED_TEX_COMMAND_PATTERN.search(latex)
    if match:
        raise FormulaRenderError(f"Unsupported LaTeX command: {match.group(0)}")


def wrap_texlive_formula(latex: str) -> str:
    if DISPLAY_ENV_PATTERN.match(latex):
        return latex
    return "\\[\n" + latex + "\n\\]"
