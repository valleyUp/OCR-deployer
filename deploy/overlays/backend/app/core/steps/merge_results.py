"""
结果合并步骤
"""

from typing import Dict, Any, List, Optional, Callable
from pathlib import Path
import json
import os

from app.core.flows.base import ProcessingContext
from app.services.formula_service import (
    extract_formulas_from_layout,
    looks_like_formula,
    normalize_latex,
    should_keep_formula_mode_block,
)
from app.utils.logger import logger


class MergeResultsStepInput:
    ocr_result_path: str

    def __init__(self, ocr_result_path: str) -> None:
        self.ocr_result_path = ocr_result_path


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _normalize_page_sizes(value: Any) -> List[Dict[str, int]]:
    page_sizes: List[Dict[str, int]] = []

    if isinstance(value, list):
        iterable = enumerate(value, start=1)
    elif isinstance(value, dict):
        iterable = value.items()
    else:
        return page_sizes

    for fallback_index, entry in iterable:
        if not isinstance(entry, dict):
            continue
        page_index = _positive_int(entry.get("page_index")) or _positive_int(
            fallback_index
        )
        width = _positive_int(entry.get("width"))
        height = _positive_int(entry.get("height"))
        if page_index and width and height:
            page_size = {
                "page_index": page_index,
                "width": width,
                "height": height,
            }
            dpi = _positive_int(entry.get("dpi"))
            if dpi:
                page_size["dpi"] = dpi
            page_sizes.append(page_size)

    return page_sizes


def _page_sizes_from_pages(pages: List[Dict[str, Any]]) -> List[Dict[str, int]]:
    page_sizes: List[Dict[str, int]] = []
    for fallback_index, page in enumerate(pages, start=1):
        if not isinstance(page, dict):
            continue
        page_index = _positive_int(page.get("page_index")) or fallback_index
        width = _positive_int(page.get("width"))
        height = _positive_int(page.get("height"))
        if width and height:
            page_sizes.append({
                "page_index": page_index,
                "width": width,
                "height": height,
            })
    return page_sizes


def _resolve_page_sizes(
    context_metadata: Dict[str, Any],
    ocr_results: Dict[str, Any],
    pages: List[Dict[str, Any]],
) -> List[Dict[str, int]]:
    context_page_sizes = _normalize_page_sizes(context_metadata.get("page_sizes"))
    resolved_page_sizes = (
        _normalize_page_sizes(ocr_results.get("page_sizes"))
        or _page_sizes_from_pages(pages)
    )
    if not resolved_page_sizes:
        return context_page_sizes

    context_by_index = {
        entry["page_index"]: entry
        for entry in context_page_sizes
        if "dpi" in entry
    }
    return [
        {
            **entry,
            **(
                {"dpi": context_by_index[entry["page_index"]]["dpi"]}
                if "dpi" not in entry and entry["page_index"] in context_by_index
                else {}
            ),
        }
        for entry in resolved_page_sizes
    ]


def _dimensions_for_page(
    page_index: int,
    page: Dict[str, Any],
    page_sizes_by_index: Dict[int, Dict[str, int]],
) -> tuple[int | None, int | None]:
    width = _positive_int(page.get("width"))
    height = _positive_int(page.get("height"))
    if width and height:
        return width, height

    page_size = page_sizes_by_index.get(page_index)
    if page_size:
        return page_size["width"], page_size["height"]

    return None, None



async def merge_results(
    context: ProcessingContext,
    input: MergeResultsStepInput,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """
    合并OCR结果

    Args:
        context: 处理上下文
        input: MergeResultsStepInput，包含 ocr_result_path
        progress_callback: 进度回调函数

    Returns:
        Dict[str, Any]: 合并后的结果
    """
    task_id = context.task_id
    output_format = context.output_format
    output_dir = context.get_output_dir()
    result_path = input.ocr_result_path
    logger.info(f"[{task_id}] Starting result merge")

    try:
        if progress_callback:
            await progress_callback(0.0, "Initializing merge")

        # 从文件读取OCR结果
        ocr_results = {}
        try:
            with open(result_path, "r", encoding="utf-8") as f:
                result_data = json.load(f)
                ocr_results.update(result_data)
        except Exception as e:
            logger.error(
                f"[{task_id}] Failed to read OCR result from {result_path}: {e}"
            )

        # 根据输出格式进行合并
        md_output_path, json_output_path = await _merge_to_markdown(
            context, ocr_results, output_dir, progress_callback
        )

        if progress_callback:
            await progress_callback(100.0, "Merge completed")

        result = {
            "md_output_path": md_output_path,
            "json_output_path": json_output_path,
            "output_files": [md_output_path, json_output_path],
            "metadata": {
                "format": output_format,
                "total_pages": len(ocr_results.get("pages", [])),
            },
        }

        logger.info(
            f"[{task_id}] Result merge completed: md_output_path:{md_output_path},json_output_path:{json_output_path}"
        )

        return result

    except Exception as e:
        logger.error(f"[{task_id}] Result merge failed: {e}")
        raise


async def _merge_to_markdown(
    context: ProcessingContext,
    ocr_results: Dict[str, Any],
    output_dir: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
):
    """合并为Markdown格式"""
    pages = ocr_results.get("pages", [])
    context_metadata = context.metadata or {}
    page_sizes = _resolve_page_sizes(context_metadata, ocr_results, pages)
    page_sizes_by_index = {entry["page_index"]: entry for entry in page_sizes}
    total_pages = len(pages)

    markdown_lines = []
    result = {}
    result["metadata"] = {
        **context_metadata,
        "task_id": context.task_id,
        "document_id": context.document_id,
        "processing_mode": context.processing_mode,
        "total_pages": total_pages,
        "page_sizes": page_sizes,
    }
    if page_sizes:
        first_page_size = page_sizes[0]
        result["metadata"].setdefault("width", first_page_size["width"])
        result["metadata"].setdefault("height", first_page_size["height"])
        result["metadata"].setdefault("page_size", {
            "width": first_page_size["width"],
            "height": first_page_size["height"],
        })
    merge_res_layout = []
    for page in pages:
        page_index = _positive_int(page.get("page_index")) or 1
        page_width, page_height = _dimensions_for_page(
            page_index,
            page,
            page_sizes_by_index,
        )
        layout = page.get("layout", {}).get("blocks", [])
        for block in layout:
            text = block.get("content", "")
            layout_type = block.get("layout_type", "")
            if context.processing_mode == "formula" and not should_keep_formula_mode_block(
                layout_type,
                text,
            ):
                continue
            if layout_type == "image":
                img_name = block.get("image_path")
                # 将相对路径转换为绝对路径
                if img_name and not os.path.isabs(img_name):
                    img_name = os.path.abspath(img_name)

                text = f'<div style="text-align: center;"><img src="/api/v1/tasks/file?path={img_name}" alt="Image"/></div>\n'
            markdown_lines.append(f"{text}\n")
            block_page_index = _positive_int(block.get("page_index")) or page_index
            block_page_width = _positive_int(block.get("page_width")) or page_width
            block_page_height = _positive_int(block.get("page_height")) or page_height
            layout_entry = {
                "block_content": text,
                "bbox": block.get("layout_box"),
                "block_id": block.get("index"),
                "page_index": block_page_index,
                "layout_type": layout_type,
            }
            if block_page_width and block_page_height:
                layout_entry["page_width"] = block_page_width
                layout_entry["page_height"] = block_page_height
            if block.get("formula") or looks_like_formula(layout_type, text):
                latex = normalize_latex(
                    (block.get("formula") or {}).get("latex")
                    if isinstance(block.get("formula"), dict)
                    else text
                )
                layout_entry["formula_id"] = block.get("formula_id") or (
                    f"formula-p{int(block.get('page_index') or 1):04d}-b{block.get('index')}"
                )
                layout_entry["formula"] = {"latex": latex}
            merge_res_layout.append(layout_entry)
    if progress_callback:
        progress = 100.0
        await progress_callback(progress, f"Merged {total_pages} pages")
    result["full_markdown"] = "".join(markdown_lines)
    result["layout"] = merge_res_layout
    result["formulas"] = extract_formulas_from_layout(
        merge_res_layout,
        task_id=context.task_id,
    )
    # 写入文件
    md_output_path = str(Path(output_dir) / "result.md")
    with open(md_output_path, "w", encoding="utf-8") as f:
        f.writelines(markdown_lines)
    json_output_path = str(Path(output_dir) / "merged.json")
    with open(json_output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    return md_output_path, json_output_path
