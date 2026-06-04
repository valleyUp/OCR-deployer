from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any

from app.services.formulas.formats import normalize_latex
from app.services.formulas.types import (
    DISPLAY_FORMULA_CONTENT_LAYOUT_TYPES,
    DISPLAY_MATH_PATTERN,
    FORMULA_CONTENT_LAYOUT_TYPES,
    FORMULA_NUMBER_LAYOUT_TYPES,
    INLINE_FORMULA_LAYOUT_TYPES,
    INLINE_MATH_FULL_PATTERN,
    MATH_PATTERN,
)


def extract_latex_candidates(content: object) -> list[str]:
    text = "" if content is None else str(content)
    candidates = [
        normalize_latex(match.group(0)) for match in MATH_PATTERN.finditer(text)
    ]
    candidates = [item for item in candidates if item]
    return candidates or [normalize_latex(text)]


def _normalized_layout_type(layout_type: object) -> str:
    return str(layout_type or "").strip().lower().replace("-", "_")


def is_explicit_formula_layout(layout_type: object) -> bool:
    label = _normalized_layout_type(layout_type)
    if label in FORMULA_CONTENT_LAYOUT_TYPES:
        return True
    if "equation" in label:
        return "number" not in label
    if "formula" in label:
        return "number" not in label
    return False


def is_display_formula_layout(layout_type: object) -> bool:
    label = _normalized_layout_type(layout_type)
    if not label or label in INLINE_FORMULA_LAYOUT_TYPES:
        return False
    if label in DISPLAY_FORMULA_CONTENT_LAYOUT_TYPES:
        return True
    if "inline" in label:
        return False
    if "equation" in label:
        return "number" not in label
    if "formula" in label:
        return "number" not in label
    return False


def is_formula_number_layout(layout_type: object) -> bool:
    label = _normalized_layout_type(layout_type)
    return label in FORMULA_NUMBER_LAYOUT_TYPES or (
        ("formula" in label or "equation" in label) and "number" in label
    )


def is_formula_only_content(content: object) -> bool:
    text = "" if content is None else str(content).strip()
    if not text:
        return False

    normalized = normalize_latex(text)
    if normalized != text:
        return bool(normalized)
    if MATH_PATTERN.fullmatch(text):
        return True
    return bool(re.fullmatch(r"\\[A-Za-z]+(?:\s|[{_^\[]|$)[\s\S]*", text))


def is_display_formula_only_content(content: object) -> bool:
    text = "" if content is None else str(content).strip()
    if not text:
        return False
    if DISPLAY_MATH_PATTERN.fullmatch(text):
        return True
    if INLINE_MATH_FULL_PATTERN.fullmatch(text):
        return False
    if MATH_PATTERN.search(text):
        return False
    prose_marker = r"\b(where|when|if|for|and|is|are|defined|inline)\b"
    if re.search(prose_marker, text.lower()):
        return False
    display_operator = (
        r"(\\(begin|frac|sum|prod|int|iint|iiint|lim|sqrt|left|right|tag)\b|[=^_])"
    )
    return bool(re.search(display_operator, text))


def should_keep_formula_mode_block(layout_type: object, content: object) -> bool:
    if is_formula_number_layout(layout_type):
        return False
    if is_display_formula_layout(layout_type):
        return bool(normalize_latex(content))
    if _normalized_layout_type(layout_type) in INLINE_FORMULA_LAYOUT_TYPES:
        return False
    if not _normalized_layout_type(layout_type):
        return is_display_formula_only_content(content)
    return False


def looks_like_formula(layout_type: object, content: object) -> bool:
    label = _normalized_layout_type(layout_type)
    if is_explicit_formula_layout(label):
        return True

    text = "" if content is None else str(content)
    if not text.strip():
        return False
    if is_formula_number_layout(label):
        return is_formula_only_content(text)
    if MATH_PATTERN.search(text):
        return True
    return bool(
        re.search(r"\\(frac|sum|int|sqrt|begin|alpha|beta|gamma|mathrm|tag)\b", text)
    )


def make_formula_id(page_index: int, block_id: int | str | None, ordinal: int) -> str:
    block_part = str(block_id if block_id is not None else ordinal).replace("/", "-")
    return f"formula-p{page_index:04d}-b{block_part}"


def build_formula_entry(
    *,
    task_id: str | None,
    block: Mapping[str, Any],
    latex: str,
    ordinal: int,
) -> dict[str, Any]:
    page_index = int(block.get("page_index") or 1)
    block_id = block.get("block_id") or block.get("index")
    formula_id = block.get("formula_id") or make_formula_id(
        page_index, block_id, ordinal
    )
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
    layout: Iterable[Mapping[str, Any]] | None,
    task_id: str | None = None,
) -> list[dict[str, Any]]:
    formulas: list[dict[str, Any]] = []
    if not layout:
        return formulas

    for block in layout:
        if not isinstance(block, dict):
            continue
        embedded = (
            block.get("formula") if isinstance(block.get("formula"), dict) else None
        )
        explicit_latex = normalize_latex(embedded.get("latex")) if embedded else ""
        layout_type = block.get("layout_type")
        content = block.get("block_content") or block.get("content")

        if explicit_latex:
            candidates = extract_latex_candidates(content)
            if len(candidates) > 1:
                for latex in candidates:
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
            else:
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
