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
    "equation_number",
    "isolated_formula",
    "inline_formula",
}
FORMULA_CONTENT_LAYOUT_TYPES = {
    "formula",
    "equation",
    "isolated_formula",
    "inline_formula",
}
DISPLAY_FORMULA_CONTENT_LAYOUT_TYPES = {
    "formula",
    "equation",
    "isolated_formula",
    "display_formula",
}
INLINE_FORMULA_LAYOUT_TYPES = {
    "inline_formula",
}
FORMULA_NUMBER_LAYOUT_TYPES = {
    "formula_number",
    "equation_number",
}
FORMULA_FORMATS = {
    "latex",
    "tex",
    "mathml",
    "mml",
    "png",
    "unicodemath",
    "unicode",
    "um",
}
MATH_PATTERN = re.compile(
    r"(\$\$.*?\$\$|\\\[.*?\\\]|\\\(.*?\\\)|(?<!\$)\$[^$]+\$(?!\$)|\\begin\{[^}]+\}.*?\\end\{[^}]+\})",
    re.DOTALL,
)
DISPLAY_MATH_PATTERN = re.compile(
    r"(\$\$.*?\$\$|\\\[.*?\\\]|\\begin\{[^}]+\}.*?\\end\{[^}]+\})",
    re.DOTALL,
)
INLINE_MATH_FULL_PATTERN = re.compile(
    r"(\\\(.*?\\\)|(?<!\$)\$[^$]+\$(?!\$))",
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
    if fmt in {"um", "unicode", "unicodemath"}:
        return "unicodemath"
    if fmt not in {"latex", "mathml", "png", "unicodemath"}:
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


def _normalized_layout_type(layout_type: Any) -> str:
    return str(layout_type or "").strip().lower().replace("-", "_")


def is_explicit_formula_layout(layout_type: Any) -> bool:
    label = _normalized_layout_type(layout_type)
    if label in FORMULA_CONTENT_LAYOUT_TYPES:
        return True
    if "equation" in label:
        return "number" not in label
    if "formula" in label:
        return "number" not in label
    return False


def is_display_formula_layout(layout_type: Any) -> bool:
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


def is_formula_number_layout(layout_type: Any) -> bool:
    label = _normalized_layout_type(layout_type)
    return label in FORMULA_NUMBER_LAYOUT_TYPES or (
        ("formula" in label or "equation" in label) and "number" in label
    )


def is_formula_only_content(content: Any) -> bool:
    text = "" if content is None else str(content).strip()
    if not text:
        return False

    normalized = normalize_latex(text)
    if normalized != text:
        return bool(normalized)
    if MATH_PATTERN.fullmatch(text):
        return True
    return bool(re.fullmatch(r"\\[A-Za-z]+(?:\s|[{_^\[]|$)[\s\S]*", text))


def is_display_formula_only_content(content: Any) -> bool:
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
    return bool(
        re.search(
            display_operator,
            text,
        )
    )


def should_keep_formula_mode_block(layout_type: Any, content: Any) -> bool:
    if is_formula_number_layout(layout_type):
        return False
    if is_display_formula_layout(layout_type):
        return bool(normalize_latex(content))
    if _normalized_layout_type(layout_type) in INLINE_FORMULA_LAYOUT_TYPES:
        return False
    # Some OCR endpoints omit labels in formula-only mode. Accept only pure
    # display formula text, not prose containing an inline equation.
    if not _normalized_layout_type(layout_type):
        return is_display_formula_only_content(content)
    return False


def looks_like_formula(layout_type: Any, content: Any) -> bool:
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


# LaTeX → Unicode single-char substitutions used as a best-effort fallback when
# the MathJax-based Node renderer is unavailable. Not a full UnicodeMath
# translator; preserves structure like \frac / \sqrt by best-effort rewriting.
_UNICODE_FALLBACK_SYMBOLS: Dict[str, str] = {
    r"\alpha": "α", r"\beta": "β", r"\gamma": "γ", r"\delta": "δ",
    r"\epsilon": "ε", r"\varepsilon": "ε", r"\zeta": "ζ", r"\eta": "η",
    r"\theta": "θ", r"\vartheta": "ϑ", r"\iota": "ι", r"\kappa": "κ",
    r"\lambda": "λ", r"\mu": "μ", r"\nu": "ν", r"\xi": "ξ",
    r"\omicron": "ο", r"\pi": "π", r"\varpi": "ϖ", r"\rho": "ρ",
    r"\varrho": "ϱ", r"\sigma": "σ", r"\varsigma": "ς", r"\tau": "τ",
    r"\upsilon": "υ", r"\phi": "φ", r"\varphi": "ϕ", r"\chi": "χ",
    r"\psi": "ψ", r"\omega": "ω",
    r"\Gamma": "Γ", r"\Delta": "Δ", r"\Theta": "Θ", r"\Lambda": "Λ",
    r"\Xi": "Ξ", r"\Pi": "Π", r"\Sigma": "Σ", r"\Upsilon": "Υ",
    r"\Phi": "Φ", r"\Psi": "Ψ", r"\Omega": "Ω",
    r"\le": "≤", r"\leq": "≤", r"\ge": "≥", r"\geq": "≥",
    r"\ne": "≠", r"\neq": "≠", r"\approx": "≈", r"\equiv": "≡",
    r"\sim": "∼", r"\cong": "≅", r"\propto": "∝",
    r"\times": "×", r"\div": "÷", r"\pm": "±", r"\mp": "∓",
    r"\cdot": "·", r"\cdots": "⋯", r"\ldots": "…", r"\dots": "…",
    r"\to": "→", r"\rightarrow": "→", r"\leftarrow": "←",
    r"\Rightarrow": "⇒", r"\Leftarrow": "⇐", r"\Leftrightarrow": "⇔",
    r"\mapsto": "↦", r"\infty": "∞", r"\partial": "∂", r"\nabla": "∇",
    r"\sum": "∑", r"\prod": "∏", r"\int": "∫", r"\oint": "∮",
    r"\iint": "∬", r"\iiint": "∭",
    r"\in": "∈", r"\notin": "∉", r"\ni": "∋", r"\subset": "⊂",
    r"\supset": "⊃", r"\subseteq": "⊆", r"\supseteq": "⊇",
    r"\cup": "∪", r"\cap": "∩", r"\emptyset": "∅", r"\varnothing": "∅",
    r"\forall": "∀", r"\exists": "∃", r"\neg": "¬", r"\lor": "∨",
    r"\land": "∧", r"\wedge": "∧", r"\vee": "∨",
    r"\prime": "′", r"\circ": "∘", r"\bullet": "•", r"\star": "⋆",
    r"\angle": "∠", r"\perp": "⊥", r"\parallel": "∥",
    r"\Re": "ℜ", r"\Im": "ℑ", r"\hbar": "ℏ", r"\ell": "ℓ",
    r"\mathbb{R}": "ℝ", r"\mathbb{N}": "ℕ", r"\mathbb{Z}": "ℤ",
    r"\mathbb{Q}": "ℚ", r"\mathbb{C}": "ℂ",
    r"\left": "", r"\right": "", r"\!": "", r"\,": " ",
    r"\;": " ", r"\:": " ", r"\ ": " ", r"\quad": "  ",
    r"\qquad": "    ",
}


def fallback_unicodemath(latex: str) -> str:
    """Best-effort LaTeX → UnicodeMath-ish string when MathJax is unavailable."""

    text = latex

    # \frac{a}{b} -> (a)/(b)
    frac_pattern = re.compile(r"\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}")
    prev = None
    while prev != text:
        prev = text
        text = frac_pattern.sub(lambda m: f"({m.group(1)})/({m.group(2)})", text)

    # \sqrt[n]{x} -> root(n)(x); \sqrt{x} -> √(x)
    text = re.sub(r"\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}", lambda m: f"root({m.group(1)})({m.group(2)})", text)
    text = re.sub(r"\\sqrt\s*\{([^{}]*)\}", lambda m: f"√({m.group(1)})", text)

    for token, replacement in sorted(
        _UNICODE_FALLBACK_SYMBOLS.items(), key=lambda kv: -len(kv[0])
    ):
        text = text.replace(token, replacement)

    # Strip remaining braces around single tokens: {x} -> x
    text = re.sub(r"\{([^{}]*)\}", lambda m: m.group(1), text)
    return text.strip() or latex


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
        return normalized_latex.encode("utf-8"), "application/x-tex; charset=utf-8", "tex"

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

    try:
        svg_markup = render_mathjax_markup(normalized_latex, "svg")
        png = svg_to_png(svg_markup)
    except FormulaRenderError:
        png = fallback_png(normalized_latex)
    return png, "image/png", "png"


def build_formulas_zip(formulas: List[Dict[str, Any]], formats: Sequence[str]) -> bytes:
    normalized_formats = parse_formula_formats(formats)
    buffer = io.BytesIO()
    entries: List[tuple[str, bytes]] = []
    errors: List[Dict[str, str]] = []

    for formula in formulas:
        formula_id = str(formula.get("formula_id") or "formula").replace("/", "-")
        embedded = formula.get("formula") if isinstance(formula.get("formula"), dict) else {}
        latex = str(formula.get("latex") or embedded.get("latex") or "")
        for fmt in normalized_formats:
            try:
                content, _, extension = render_formula_bytes(latex, fmt)
                entries.append((f"{formula_id}.{extension}", content))
            except Exception as exc:  # keep one bad formula from breaking the archive
                errors.append(
                    {
                        "formula_id": formula_id,
                        "format": fmt,
                        "error": str(exc),
                    }
                )
                entries.append((f"{formula_id}.{fmt}.error.txt", str(exc).encode("utf-8")))

    manifest = {
        "count": len(formulas),
        "formats": normalized_formats,
        "formulas": formulas,
        "errors": errors,
    }

    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for filename, content in entries:
            archive.writestr(filename, content)

    return buffer.getvalue()
