import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

from app.core.steps.merge_results import _merge_to_markdown


def test_merge_result_includes_page_dimensions(tmp_path: Path):
    context = SimpleNamespace(
        metadata={"width": 100, "height": 200},
        task_id="task-1",
        document_id="doc-1",
        processing_mode="pipeline",
    )
    ocr_results = {
        "page_sizes": [
            {"page_index": 1, "width": 100, "height": 200},
            {"page_index": 2, "width": 300, "height": 150},
        ],
        "pages": [
            {
                "page_index": 1,
                "width": 100,
                "height": 200,
                "layout": {
                    "blocks": [
                        {
                            "index": 1,
                            "page_index": 1,
                            "layout_type": "text",
                            "layout_box": [10, 20, 80, 60],
                            "content": "page one",
                        }
                    ]
                },
            },
            {
                "page_index": 2,
                "width": 300,
                "height": 150,
                "layout": {
                    "blocks": [
                        {
                            "index": 2,
                            "page_index": 2,
                            "layout_type": "text",
                            "layout_box": [30, 10, 260, 120],
                            "content": "page two",
                        }
                    ]
                },
            },
        ],
    }

    _, json_output_path = asyncio.run(
        _merge_to_markdown(context, ocr_results, str(tmp_path))
    )

    merged = json.loads(Path(json_output_path).read_text(encoding="utf-8"))
    assert merged["metadata"]["page_sizes"] == ocr_results["page_sizes"]
    assert merged["metadata"]["width"] == 100
    assert merged["metadata"]["height"] == 200
    assert merged["layout"] == [
        {
            "block_content": "page one",
            "bbox": [10, 20, 80, 60],
            "block_id": 1,
            "page_index": 1,
            "layout_type": "text",
            "page_width": 100,
            "page_height": 200,
        },
        {
            "block_content": "page two",
            "bbox": [30, 10, 260, 120],
            "block_id": 2,
            "page_index": 2,
            "layout_type": "text",
            "page_width": 300,
            "page_height": 150,
        },
    ]
