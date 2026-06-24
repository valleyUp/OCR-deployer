"""
PDF converter overlay.

Keeps each rendered page at its natural size instead of resizing every page to
match the first page.  The first-page metadata remains for backward
compatibility, while ``page_sizes`` records per-page geometry for bbox mapping.
"""

from __future__ import annotations

import os
from typing import Any, Dict

import fitz

from app.utils.converters.base import BaseConverter
from app.utils.converters.exceptions import ConversionFailedError
from app.utils.logger import logger


class PDFConverter(BaseConverter):
    """PDF-to-image converter that preserves per-page dimensions."""

    name = "pdf_converter"

    supported_extensions = {".pdf"}

    async def convert(
        self,
        file_path: str,
        output_dir: str,
        dpi: int = 200,
        format: str = "png",
        **kwargs,
    ) -> Dict[str, Any]:
        """Convert every PDF page to an image without cross-page resizing."""
        self.ensure_output_dir(output_dir)

        output_files = []
        page_sizes = []

        pdf_document = None
        try:
            pdf_document = fitz.open(file_path)
            page_count = pdf_document.page_count

            metadata = self.get_metadata(file_path)
            metadata.update({
                "title": pdf_document.metadata.get("title", ""),
                "author": pdf_document.metadata.get("author", ""),
                "subject": pdf_document.metadata.get("subject", ""),
                "creator": pdf_document.metadata.get("creator", ""),
                "producer": pdf_document.metadata.get("producer", ""),
                "creation_date": str(pdf_document.metadata.get("creationDate", "")),
                "modification_date": str(pdf_document.metadata.get("modDate", "")),
                "pages": page_count,
                "format": format,
                "dpi": dpi,
            })

            zoom = dpi / 72.0
            mat = fitz.Matrix(zoom, zoom)

            for page_num in range(page_count):
                progress = (page_num / page_count) * 100
                if page_num % 5 == 0:
                    logger.info(
                        f"PDF转换进度: {progress:.1f}% ({page_num + 1}/{page_count})"
                    )

                page = pdf_document[page_num]
                pix = page.get_pixmap(matrix=mat, alpha=False)
                page_size = {
                    "page_index": page_num + 1,
                    "width": pix.width,
                    "height": pix.height,
                    "dpi": dpi,
                }
                page_sizes.append(page_size)

                if page_num == 0:
                    metadata["page_size"] = {
                        "width": pix.width,
                        "height": pix.height,
                        "dpi": dpi,
                    }
                    metadata["width"] = pix.width
                    metadata["height"] = pix.height
                    logger.info(f"首页图片尺寸: {pix.width}x{pix.height} (DPI: {dpi})")
                else:
                    logger.info(
                        f"第{page_num + 1}页图片尺寸: {pix.width}x{pix.height} "
                        f"(DPI: {dpi})"
                    )

                output_filename = f"page_{page_num + 1:04d}.{format}"
                output_path = os.path.join(output_dir, output_filename)

                if format == "png":
                    pix.save(output_path)
                elif format == "jpg":
                    pix.save(output_path, jpeg=True)
                else:
                    raise ValueError(f"不支持的图片格式: {format}")

                output_files.append(output_path)

            metadata["page_sizes"] = page_sizes

            return {
                "output_files": output_files,
                "page_count": page_count,
                "metadata": metadata,
            }

        except Exception as e:
            logger.error(f"PDF转换失败: {str(e)}")
            raise ConversionFailedError(f"PDF转换失败: {str(e)}") from e
        finally:
            if pdf_document is not None:
                pdf_document.close()

    async def validate(self, file_path: str) -> bool:
        """Validate whether *file_path* is a non-empty PDF with pages."""
        try:
            if not os.path.exists(file_path):
                logger.error(f"PDF文件不存在: {file_path}")
                return False

            if not file_path.lower().endswith(".pdf"):
                logger.error(f"不是PDF文件: {file_path}")
                return False

            file_size = os.path.getsize(file_path)
            if file_size == 0:
                logger.error("PDF文件为空")
                return False

            pdf_document = fitz.open(file_path)
            page_count = pdf_document.page_count
            pdf_document.close()

            if page_count == 0:
                logger.error("PDF文件没有页面")
                return False

            logger.info(f"PDF文件验证通过，共 {page_count} 页")
            return True

        except Exception as e:
            logger.error(f"PDF文件验证失败: {str(e)}")
            return False
