from __future__ import annotations

import re
from typing import Final


class FormulaRenderError(ValueError):
    """Raised when a formula cannot be rendered."""


FORMULA_CONTENT_LAYOUT_TYPES: Final = {
    "formula",
    "equation",
    "isolated_formula",
    "inline_formula",
}
DISPLAY_FORMULA_CONTENT_LAYOUT_TYPES: Final = {
    "formula",
    "equation",
    "isolated_formula",
    "display_formula",
}
INLINE_FORMULA_LAYOUT_TYPES: Final = {
    "inline_formula",
}
FORMULA_NUMBER_LAYOUT_TYPES: Final = {
    "formula_number",
    "equation_number",
}
FORMULA_LAYOUT_TYPES: Final = FORMULA_CONTENT_LAYOUT_TYPES | FORMULA_NUMBER_LAYOUT_TYPES
FORMULA_FORMATS: Final = {
    "latex",
    "tex",
    "mathml",
    "mml",
    "svg",
    "png",
    "unicodemath",
    "unicode",
    "um",
}
MATH_PATTERN: Final = re.compile(
    r"(\$\$.*?\$\$|\\\[.*?\\\]|\\\(.*?\\\)|(?<!\$)\$[^$]+\$(?!\$)|\\begin\{[^}]+\}.*?\\end\{[^}]+\})",
    re.DOTALL,
)
DISPLAY_MATH_PATTERN: Final = re.compile(
    r"(\$\$.*?\$\$|\\\[.*?\\\]|\\begin\{[^}]+\}.*?\\end\{[^}]+\})",
    re.DOTALL,
)
INLINE_MATH_FULL_PATTERN: Final = re.compile(
    r"(\\\(.*?\\\)|(?<!\$)\$[^$]+\$(?!\$))",
    re.DOTALL,
)
BLOCKED_TEX_COMMAND_PATTERN: Final = re.compile(
    r"\\(?:"
    r"documentclass|usepackage|input|include|includeonly|openin|openout|"
    r"read|write|write18|directlua|catcode|special|shipout"
    r")\b"
)
DISPLAY_ENV_PATTERN: Final = re.compile(
    r"^\s*\\begin\{"
    r"(?:align|align\*|alignat|alignat\*|equation|equation\*|gather|gather\*|"
    r"multline|multline\*|flalign|flalign\*)"
    r"\}"
)
TEXLIVE_PACKAGES: Final = [
    "amsmath",
    "amssymb",
    "mathtools",
    "bm",
    "cancel",
    "braket",
    "physics",
    "mhchem",
    "siunitx",
]
