"""
版面分析和OCR处理步骤
"""

import asyncio
import json
from typing import Dict, Any, Optional, Callable, List, Union
from pathlib import Path
from app.core.ocr_client import LayoutAndOCRClient
import httpx
import base64
import os
from app.core.flows.base import ProcessingContext
from app.utils.config import settings
from app.utils.image_processer import crop_image_by_bbox_to_path, vlm_bbox_convert
from app.utils.logger import logger
from app.services.formula_service import looks_like_formula, normalize_latex, should_keep_formula_mode_block
from PIL import Image


class LayoutOcrStepInput:
    image_files_path: List[str]  # 图片文件路径列表
    page_count: Optional[int]  # 页数
    images_dir: Optional[str]  # 图片目录

    def __init__(
        self,
        image_files_path: List[str],
        page_count: Optional[int] = None,
        images_dir: Optional[str] = None,
    ) -> None:
        self.image_files_path = image_files_path
        self.page_count = page_count
        self.images_dir = images_dir


async def layout_and_ocr(
    context: ProcessingContext,
    input: LayoutOcrStepInput,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """
    执行版面分析和OCR处理

    Args:
        context: 处理上下文
        pdf_result: PDF转图片的结果，包含:
            - output_files: list[str] - 图片文件路径列表
            - page_count: int - 页数
            - images_dir: str - 图片目录
        progress_callback: 进度回调函数

    Returns:
        Dict[str, Any]: OCR结果
    """
    task_id = context.task_id
    ocr_config = context.ocr_config

    # 获取图片文件列表
    image_files = input.image_files_path
    images_dir = input.images_dir
    page_count = input.page_count
    page_size = (context.metadata or {}).get("page_size")
    logger.info(f"[{task_id}] Starting layout and OCR processing")
    logger.info(f"[{task_id}] Processing {page_count} pages from {images_dir}")

    try:
        # 调用实际的版面分析和OCR服务
        # 这里需要根据实际的OCR API来实现

        # 示例：假设我们有一个OCR客户端
        result = await _call_ocr_service(
            page_size=page_size,
            image_files=image_files,
            images_dir=images_dir,
            page_count=page_count,
            config=ocr_config,
            output_dir=context.get_output_dir(),
            processing_mode=context.processing_mode,
            progress_callback=progress_callback,
        )

        logger.info(f"[{task_id}] Layout and OCR processing completed")

        return result

    except Exception as e:
        logger.error(f"[{task_id}] Layout and OCR processing failed: {e}")
        raise


async def _call_ocr_service(
    image_files: list[str],
    images_dir: str,
    page_count: int,
    config: Dict[str, Any],
    output_dir: str,
    page_size: Dict[str, Any],
    processing_mode: str = "pipeline",
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """
    调用OCR服务

    这里是示例实现，实际需要根据您的OCR服务来调整

    Args:
        image_files: 图片文件路径列表
        images_dir: 图片目录
        page_count: 页数
        config: OCR配置
        output_dir: 输出目录
        progress_callback: 进度回调
    """

    if progress_callback:
        await progress_callback(0.0, f"Initializing OCR service for {page_count} pages")
    custom_url = config.get("custom_url", None)
    cli = LayoutAndOCRClient()
    pages_result = []
    total_pages = page_count or len(image_files) or 1
    page_width = page_size.get("width") if isinstance(page_size, dict) else None
    page_height = page_size.get("height") if isinstance(page_size, dict) else None
    block_idx = 1
    ref_image_paths = []

    prompt = config.get("prompt")
    parallelism = max(1, int(getattr(settings, "LAYOUT_PAGE_PARALLELISM", 1)))
    semaphore = asyncio.Semaphore(parallelism) if parallelism > 1 else None
    done_counter = {"done": 0}

    async def _recognise_page(index: int, image_file: str) -> Dict[str, Any]:
        page_num = index + 1
        current_w = page_width
        current_h = page_height
        if not current_w or not current_h:
            try:
                with Image.open(image_file) as image:
                    current_w, current_h = image.size
            except Exception as e:
                logger.warning(f"Failed to read image size from {image_file}: {e}")
                current_w, current_h = 1000, 1000

        async def _call() -> List[Dict[str, Any]]:
            return await cli.process_single_image(
                image_file,
                prompt=prompt,
                custom_url=custom_url,
                processing_mode=processing_mode,
            )

        if semaphore is not None:
            async with semaphore:
                result = await _call()
        else:
            result = await _call()

        if progress_callback:
            done_counter["done"] += 1
            done = done_counter["done"]
            progress = (done / total_pages) * 100
            try:
                await progress_callback(
                    progress, f"Processing page {done}/{total_pages}"
                )
            except Exception:
                pass

        return {
            "page_num": page_num,
            "image_file": image_file,
            "page_width": current_w,
            "page_height": current_h,
            "blocks": result,
        }

    if parallelism > 1 and len(image_files) > 1:
        page_outputs = await asyncio.gather(
            *[_recognise_page(i, f) for i, f in enumerate(image_files)]
        )
        page_outputs.sort(key=lambda p: p["page_num"])
    else:
        page_outputs = []
        for i, image_file in enumerate(image_files):
            page_outputs.append(await _recognise_page(i, image_file))

    for page in page_outputs:
        page_num = page["page_num"]
        image_file = page["image_file"]
        current_page_width = page["page_width"]
        current_page_height = page["page_height"]
        result = page["blocks"]
        page_blocks = []
        for idx, block in enumerate(result):
            if not isinstance(block, dict):
                logger.warning(f"Unexpected block type on page {page_num}: {type(block)}")
                continue

            block_label = block.get("label", "text")
            raw_bbox = block.get("bbox_2d")
            if isinstance(raw_bbox, (list, tuple)) and len(raw_bbox) == 4:
                block_bbox = list(raw_bbox)
            else:
                block_bbox = [0, 0, 0, 0]
            block_content = block.get("content", None)
            if processing_mode == "formula":
                if not should_keep_formula_mode_block(block_label, block_content):
                    continue
                is_formula = True
            else:
                is_formula = looks_like_formula(block_label, block_content)

            block_index = block_idx
            normalized_box = vlm_bbox_convert(
                block_bbox,
                current_page_width,
                current_page_height,
            )

            # 如果 label 为 image，则裁剪图片并添加到 image_path 字段
            image_path_field = None
            if block_label == "image":
                try:
                    split_filename = f"split_{page_num}_{block_idx:04d}.png"
                    split_path = os.path.join(output_dir, split_filename)
                    crop_image_by_bbox_to_path(image_file, normalized_box, split_path)
                    image_path_field = split_path
                    ref_image_paths.append(image_path_field)
                    logger.info(f"裁剪图片块 {block_idx}: {split_filename}")
                except Exception as e:
                    logger.warning(f"裁剪图片块 {block_idx} 失败: {str(e)}")

            block_info = {
                "layout_type": block_label,
                "layout_box": normalized_box,
                "content": block_content,
                "index": block_index,
                "image_path": image_path_field,
                "page_index": page_num,
            }
            if is_formula:
                block_info["formula_id"] = f"formula-p{page_num:04d}-b{block_index}"
                block_info["formula"] = {"latex": normalize_latex(block_content)}
            page_blocks.append(block_info)
            block_idx += 1

        pages_result.append(
            {
                "page_index": page_num,
                "image_file": image_file,
                "layout": {"blocks": page_blocks},
            }
        )

    if progress_callback:
        await progress_callback(100.0, "OCR processing completed")

    # 保存OCR结果到JSON
    ocr_result_file = Path(output_dir) / "ocr_result.json"
    ocr_result_data = {
        "success": True,
        "pages": pages_result,
        "total_pages": total_pages,
        "images_dir": images_dir,
        "ocr_result_file": f"{ocr_result_file}",
        "ref_image_paths": ref_image_paths,
    }

    try:
        with open(ocr_result_file, "w", encoding="utf-8") as f:
            json.dump(ocr_result_data, f, ensure_ascii=False, indent=2)
        logger.info(f"OCR results saved to: {ocr_result_file}")
    except Exception as e:
        logger.error(f"Failed to save OCR results: {e}")

    return ocr_result_data
