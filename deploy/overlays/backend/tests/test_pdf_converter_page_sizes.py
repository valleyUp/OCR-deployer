import asyncio
from pathlib import Path

import pytest

fitz = pytest.importorskip("fitz")
Image = pytest.importorskip("PIL.Image")

from app.utils.converters.pdf import PDFConverter


def test_pdf_converter_preserves_mixed_page_sizes(tmp_path: Path):
    pdf_path = tmp_path / "mixed.pdf"
    pdf = fitz.open()
    pdf.new_page(width=200, height=300)
    pdf.new_page(width=400, height=250)
    pdf.save(pdf_path)
    pdf.close()

    output_dir = tmp_path / "images"
    result = asyncio.run(PDFConverter().convert(str(pdf_path), str(output_dir), dpi=72))

    assert result["page_count"] == 2
    assert len(result["output_files"]) == 2

    rendered_sizes = []
    for output_file in result["output_files"]:
        with Image.open(output_file) as image:
            rendered_sizes.append(image.size)

    assert rendered_sizes == [(200, 300), (400, 250)]
    assert result["metadata"]["width"] == 200
    assert result["metadata"]["height"] == 300
    assert result["metadata"]["page_size"] == {
        "width": 200,
        "height": 300,
        "dpi": 72,
    }
    assert result["metadata"]["page_sizes"] == [
        {"page_index": 1, "width": 200, "height": 300, "dpi": 72},
        {"page_index": 2, "width": 400, "height": 250, "dpi": 72},
    ]
