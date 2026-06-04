from __future__ import annotations

import html
import io
import re
from typing import Final

from PIL import Image, ImageDraw


def fallback_mathml(latex: str) -> str:
    escaped = html.escape(latex)
    return f'<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext>{escaped}</mtext></math>'


_UNICODE_FALLBACK_SYMBOLS: Final[dict[str, str]] = {
    r"\alpha": "α",
    r"\beta": "β",
    r"\gamma": "γ",
    r"\delta": "δ",
    r"\epsilon": "ε",
    r"\varepsilon": "ε",
    r"\zeta": "ζ",
    r"\eta": "η",
    r"\theta": "θ",
    r"\vartheta": "ϑ",
    r"\iota": "ι",
    r"\kappa": "κ",
    r"\lambda": "λ",
    r"\mu": "μ",
    r"\nu": "ν",
    r"\xi": "ξ",
    r"\omicron": "ο",
    r"\pi": "π",
    r"\varpi": "ϖ",
    r"\rho": "ρ",
    r"\varrho": "ϱ",
    r"\sigma": "σ",
    r"\varsigma": "ς",
    r"\tau": "τ",
    r"\upsilon": "υ",
    r"\phi": "φ",
    r"\varphi": "ϕ",
    r"\chi": "χ",
    r"\psi": "ψ",
    r"\omega": "ω",
    r"\Gamma": "Γ",
    r"\Delta": "Δ",
    r"\Theta": "Θ",
    r"\Lambda": "Λ",
    r"\Xi": "Ξ",
    r"\Pi": "Π",
    r"\Sigma": "Σ",
    r"\Upsilon": "Υ",
    r"\Phi": "Φ",
    r"\Psi": "Ψ",
    r"\Omega": "Ω",
    r"\le": "≤",
    r"\leq": "≤",
    r"\ge": "≥",
    r"\geq": "≥",
    r"\ne": "≠",
    r"\neq": "≠",
    r"\approx": "≈",
    r"\equiv": "≡",
    r"\sim": "∼",
    r"\cong": "≅",
    r"\propto": "∝",
    r"\times": "×",
    r"\div": "÷",
    r"\pm": "±",
    r"\mp": "∓",
    r"\cdot": "·",
    r"\cdots": "⋯",
    r"\ldots": "…",
    r"\dots": "…",
    r"\to": "→",
    r"\rightarrow": "→",
    r"\leftarrow": "←",
    r"\Rightarrow": "⇒",
    r"\Leftarrow": "⇐",
    r"\Leftrightarrow": "⇔",
    r"\mapsto": "↦",
    r"\infty": "∞",
    r"\partial": "∂",
    r"\nabla": "∇",
    r"\sum": "∑",
    r"\prod": "∏",
    r"\int": "∫",
    r"\oint": "∮",
    r"\iint": "∬",
    r"\iiint": "∭",
    r"\in": "∈",
    r"\notin": "∉",
    r"\ni": "∋",
    r"\subset": "⊂",
    r"\supset": "⊃",
    r"\subseteq": "⊆",
    r"\supseteq": "⊇",
    r"\cup": "∪",
    r"\cap": "∩",
    r"\emptyset": "∅",
    r"\varnothing": "∅",
    r"\forall": "∀",
    r"\exists": "∃",
    r"\neg": "¬",
    r"\lor": "∨",
    r"\land": "∧",
    r"\wedge": "∧",
    r"\vee": "∨",
    r"\prime": "′",
    r"\circ": "∘",
    r"\bullet": "•",
    r"\star": "⋆",
    r"\angle": "∠",
    r"\perp": "⊥",
    r"\parallel": "∥",
    r"\Re": "ℜ",
    r"\Im": "ℑ",
    r"\hbar": "ℏ",
    r"\ell": "ℓ",
    r"\mathbb{R}": "ℝ",
    r"\mathbb{N}": "ℕ",
    r"\mathbb{Z}": "ℤ",
    r"\mathbb{Q}": "ℚ",
    r"\mathbb{C}": "ℂ",
    r"\left": "",
    r"\right": "",
    r"\!": "",
    r"\,": " ",
    r"\;": " ",
    r"\:": " ",
    r"\ ": " ",
    r"\quad": "  ",
    r"\qquad": "    ",
}


def fallback_unicodemath(latex: str) -> str:
    text = latex
    frac_pattern = re.compile(r"\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}")
    prev = None
    while prev != text:
        prev = text
        text = frac_pattern.sub(lambda m: f"({m.group(1)})/({m.group(2)})", text)

    text = re.sub(
        r"\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}",
        lambda m: f"root({m.group(1)})({m.group(2)})",
        text,
    )
    text = re.sub(r"\\sqrt\s*\{([^{}]*)\}", lambda m: f"√({m.group(1)})", text)

    for token, replacement in sorted(
        _UNICODE_FALLBACK_SYMBOLS.items(), key=lambda kv: -len(kv[0])
    ):
        text = text.replace(token, replacement)

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
