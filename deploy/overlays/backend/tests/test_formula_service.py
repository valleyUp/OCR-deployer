import io
import json
import zipfile

from app.services.formula_service import (
    FormulaRenderError,
    build_formulas_zip,
    extract_formulas_from_layout,
    normalize_latex,
    parse_formula_formats,
    render_formula_bytes,
    should_keep_formula_mode_block,
)
import pytest


def test_extracts_structured_formula_blocks():
    layout = [
        {
            "block_content": "$$E = mc^2$$",
            "bbox": [1, 2, 3, 4],
            "block_id": 7,
            "page_index": 2,
            "layout_type": "formula",
        },
        {
            "block_content": "plain text",
            "block_id": 8,
            "page_index": 2,
            "layout_type": "text",
        },
    ]

    formulas = extract_formulas_from_layout(layout, task_id="task-1")

    assert len(formulas) == 1
    assert formulas[0]["formula_id"] == "formula-p0002-b7"
    assert formulas[0]["latex"] == "E = mc^2"
    assert formulas[0]["bbox"] == [1, 2, 3, 4]


def test_extracts_inline_formula_candidates_from_text():
    formulas = extract_formulas_from_layout(
        [
            {
                "block_content": "where $x_i = y_i + 1$ is defined inline",
                "block_id": 1,
                "page_index": 1,
                "layout_type": "text",
            }
        ]
    )

    assert [item["latex"] for item in formulas] == ["x_i = y_i + 1"]


def test_formula_mode_filter_keeps_only_formula_layout_blocks():
    assert should_keep_formula_mode_block("display_formula", r"\[ E = mc^2 \]")
    assert should_keep_formula_mode_block("equation", r"\frac{a}{b}")
    assert should_keep_formula_mode_block("formula", "$$E=mc^2$$")
    assert not should_keep_formula_mode_block("inline_formula", "$x_i$")
    assert not should_keep_formula_mode_block(
        "text",
        "where $x_i = y_i + 1$ is defined inline",
    )
    assert not should_keep_formula_mode_block("formula_number", "(1)")


def test_formula_mode_unlabeled_fallback_rejects_inline_math():
    assert should_keep_formula_mode_block("", r"\[ E = mc^2 \]")
    assert should_keep_formula_mode_block("", r"\frac{a}{b}")
    assert not should_keep_formula_mode_block("", "$x_i$")
    assert not should_keep_formula_mode_block(
        "",
        "where $x_i = y_i + 1$ is defined inline",
    )


def test_render_and_zip_exports_are_format_stable():
    assert normalize_latex(r"\[ a + b \]") == "a + b"
    assert parse_formula_formats("tex,mml,um,png") == [
        "latex",
        "mathml",
        "unicodemath",
        "png",
    ]

    content, media_type, extension = render_formula_bytes("a+b", "latex")
    assert content == b"a+b"
    assert media_type.startswith("application/x-tex")
    assert extension == "tex"

    formulas = [{"formula_id": "formula-1", "latex": "a+b"}]
    archive = build_formulas_zip(formulas, ["latex", "mathml"])
    with zipfile.ZipFile(io.BytesIO(archive)) as zip_file:
        assert sorted(zip_file.namelist()) == [
            "formula-1.mml",
            "formula-1.tex",
            "manifest.json",
        ]
        manifest = json.loads(zip_file.read("manifest.json"))
        assert manifest["count"] == 1
        assert manifest["errors"] == []


def test_zip_export_records_bad_formula_without_failing_archive():
    formulas = [{"formula_id": "formula-1", "latex": r"\frac{a"}]
    archive = build_formulas_zip(formulas, ["latex", "mathml"])

    with zipfile.ZipFile(io.BytesIO(archive)) as zip_file:
        names = sorted(zip_file.namelist())
        assert "formula-1.mathml.error.txt" in names
        assert "manifest.json" in names
        manifest = json.loads(zip_file.read("manifest.json"))
        assert manifest["errors"][0]["formula_id"] == "formula-1"


def test_unicodemath_falls_back_when_renderer_is_missing(monkeypatch):
    monkeypatch.setattr(
        "app.services.formula_service._renderer_script",
        lambda: "/nonexistent/formula-renderer.cjs",
    )

    content, media_type, extension = render_formula_bytes(
        r"\frac{\alpha}{\beta}", "unicodemath"
    )

    text = content.decode("utf-8")
    assert extension == "txt"
    assert media_type.startswith("text/plain")
    assert "α" in text and "β" in text
    assert "\\frac" not in text


def test_parse_formula_formats_accepts_unicodemath_aliases():
    assert parse_formula_formats("unicode") == ["unicodemath"]
    assert parse_formula_formats(["UM", "UnicodeMath"]) == ["unicodemath"]


def test_rejects_obviously_invalid_latex():
    with pytest.raises(FormulaRenderError):
        render_formula_bytes(r"\frac{a", "mathml")
