from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Mapping, Sequence
from typing import Any

from app.services.formulas.formats import parse_formula_formats
from app.services.formulas.rendering import render_formula_bytes


def build_formulas_zip(
    formulas: list[Mapping[str, Any]], formats: Sequence[str]
) -> bytes:
    normalized_formats = parse_formula_formats(formats)
    buffer = io.BytesIO()
    entries: list[tuple[str, bytes]] = []
    errors: list[dict[str, str]] = []

    for formula in formulas:
        formula_id = str(formula.get("formula_id") or "formula").replace("/", "-")
        embedded = (
            formula.get("formula") if isinstance(formula.get("formula"), dict) else {}
        )
        latex = str(formula.get("latex") or embedded.get("latex") or "")
        for fmt in normalized_formats:
            try:
                content, _, extension = render_formula_bytes(latex, fmt)
                entries.append((f"{formula_id}.{extension}", content))
            except Exception as exc:
                errors.append(
                    {
                        "formula_id": formula_id,
                        "format": fmt,
                        "error": str(exc),
                    }
                )
                entries.append(
                    (f"{formula_id}.{fmt}.error.txt", str(exc).encode("utf-8"))
                )

    manifest = {
        "count": len(formulas),
        "formats": normalized_formats,
        "formulas": formulas,
        "errors": errors,
    }

    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2)
        )
        for filename, content in entries:
            archive.writestr(filename, content)

    return buffer.getvalue()
