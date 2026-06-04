from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_result_file(result_file_path: str | Path) -> dict[str, Any]:
    path = Path(result_file_path)
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError("Task result is not a JSON object")
    return data
