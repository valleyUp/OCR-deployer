#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import math
import re
import tempfile
import time
from collections import defaultdict
from dataclasses import dataclass, asdict
from datetime import datetime, UTC
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    import httpx


@dataclass
class ChunkTask:
    index: int
    start_page: int
    end_page: int
    file_path: Path
    task_id: str | None = None
    status: str | None = None
    progress: float | None = None
    result: dict[str, Any] | None = None
    error: str | None = None

    @property
    def page_count(self) -> int:
        return self.end_page - self.start_page + 1


def log(message: str) -> None:
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] {message}", flush=True)


def require_httpx():
    try:
        import httpx
    except ModuleNotFoundError as exc:
        raise SystemExit("缺少依赖 httpx，请先安装: pip install httpx") from exc
    return httpx


def require_pypdf2():
    try:
        from PyPDF2 import PdfReader, PdfWriter
    except ModuleNotFoundError as exc:
        raise SystemExit("缺少依赖 PyPDF2，请先安装: pip install PyPDF2") from exc
    return PdfReader, PdfWriter


def _normalize_block_text(text: str) -> str:
    if not text:
        return ""
    lowered = text.lower()
    if "<img" in lowered:
        return ""
    text = re.sub(r"!\[[^\]]*]\([^)]+\)", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _char_units(ch: str) -> float:
    if ch in {" ", "\t"}:
        return 0.30
    if ch in {".", ",", ";", ":", "!", "|", "'", '"', "`"}:
        return 0.25
    if ch in {"(", ")", "[", "]", "{", "}"}:
        return 0.35
    if ch in {"M", "W", "@", "#", "%", "&"}:
        return 0.90
    if ord(ch) < 128:
        return 0.56
    return 1.0


def _wrap_text_by_units(text: str, max_units: float) -> list[str]:
    if max_units <= 0:
        return []

    lines: list[str] = []
    for paragraph in text.splitlines():
        para = paragraph.strip()
        if not para:
            continue

        current: list[str] = []
        current_units = 0.0
        for ch in para:
            ch_u = _char_units(ch)
            if current and current_units + ch_u > max_units:
                lines.append("".join(current).strip())
                current = [ch]
                current_units = ch_u
            else:
                current.append(ch)
                current_units += ch_u
        if current:
            lines.append("".join(current).strip())

    return [line for line in lines if line]


def _fit_text_to_box(
    text: str,
    box_width: float,
    box_height: float,
    min_font_size: float,
    max_font_size: float,
) -> tuple[float, list[str]]:
    if box_width <= 0 or box_height <= 0:
        return min_font_size, []

    max_fs = min(max_font_size, box_height)
    if max_fs < min_font_size:
        max_fs = min_font_size

    fs = max_fs
    while fs >= min_font_size:
        max_units = max(1.0, box_width / fs)
        lines = _wrap_text_by_units(text, max_units=max_units)
        if lines:
            total_h = len(lines) * fs * 1.2
            if total_h <= box_height + 0.5:
                return fs, lines
        fs -= 0.5

    fs = min_font_size
    lines = _wrap_text_by_units(text, max_units=max(1.0, box_width / fs))
    max_lines = max(1, int(box_height / (fs * 1.2)))
    return fs, lines[:max_lines]


def _infer_ocr_canvas_size(chunks: list[ChunkTask]) -> tuple[float | None, float | None]:
    for chunk in chunks:
        result = chunk.result or {}
        metadata = result.get("metadata")
        if not isinstance(metadata, dict):
            continue

        page_size = metadata.get("page_size")
        if isinstance(page_size, dict):
            width = page_size.get("width")
            height = page_size.get("height")
            if isinstance(width, (int, float)) and isinstance(height, (int, float)):
                return float(width), float(height)

        width = metadata.get("width")
        height = metadata.get("height")
        if isinstance(width, (int, float)) and isinstance(height, (int, float)):
            return float(width), float(height)

    return None, None


def _infer_canvas_from_layout(layout_blocks: list[dict[str, Any]]) -> tuple[float | None, float | None]:
    max_x = 0.0
    max_y = 0.0
    for block in layout_blocks:
        bbox = block.get("bbox")
        if not (isinstance(bbox, list) and len(bbox) == 4):
            continue
        try:
            _, _, x2, y2 = [float(v) for v in bbox]
        except (TypeError, ValueError):
            continue
        max_x = max(max_x, x2)
        max_y = max(max_y, y2)
    if max_x > 0 and max_y > 0:
        return max_x, max_y
    return None, None


def _collect_cjk_codepoints(
    layout_blocks: list[dict[str, Any]],
    page_start: int,
    page_end: int,
) -> set[int]:
    codepoints: set[int] = set()
    for block in layout_blocks:
        page_index = block.get("page_index")
        if isinstance(page_index, str) and page_index.isdigit():
            page_index = int(page_index)
        if not isinstance(page_index, int):
            continue
        if page_index < page_start or page_index > page_end:
            continue

        text = _normalize_block_text(str(block.get("block_content") or ""))
        if not text:
            continue
        if not any(ord(ch) >= 128 for ch in text):
            continue

        for ch in text:
            cp = ord(ch)
            if 0x20 <= cp <= 0xFFFF:
                codepoints.add(cp)
    return codepoints


def _build_to_unicode_cmap(codepoints: set[int]) -> bytes:
    points = sorted(cp for cp in codepoints if 0x20 <= cp <= 0xFFFF)
    if not points:
        points = [0x20]

    lines = [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin",
        "begincmap",
        "/CIDSystemInfo",
        "<< /Registry (Adobe)",
        "/Ordering (UCS)",
        "/Supplement 0",
        ">> def",
        "/CMapName /FOCRC-UCS2 def",
        "/CMapType 2 def",
        "1 begincodespacerange",
        "<0000> <FFFF>",
        "endcodespacerange",
    ]

    chunk_size = 100
    for i in range(0, len(points), chunk_size):
        group = points[i : i + chunk_size]
        lines.append(f"{len(group)} beginbfchar")
        for cp in group:
            hex_cp = f"{cp:04X}"
            lines.append(f"<{hex_cp}> <{hex_cp}>")
        lines.append("endbfchar")

    lines.extend(
        [
            "endcmap",
            "CMapName currentdict /CMap defineresource pop",
            "end",
            "end",
        ]
    )
    return ("\n".join(lines) + "\n").encode("ascii")


def _ensure_ocr_fonts(writer: Any, cjk_codepoints: set[int]) -> dict[str, Any]:
    from PyPDF2.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject, NumberObject, TextStringObject

    latin_font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
            NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
        }
    )
    latin_font_ref = writer._add_object(latin_font)

    # Type0 + UniGB-UCS2-H：覆盖中文文本层
    cid_info = DictionaryObject(
        {
            NameObject("/Registry"): TextStringObject("Adobe"),
            NameObject("/Ordering"): TextStringObject("GB1"),
            NameObject("/Supplement"): NumberObject(2),
        }
    )
    desc_font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/CIDFontType0"),
            NameObject("/BaseFont"): NameObject("/STSong-Light"),
            NameObject("/CIDSystemInfo"): cid_info,
            NameObject("/DW"): NumberObject(1000),
        }
    )
    desc_font_ref = writer._add_object(desc_font)

    to_unicode_stream = DecodedStreamObject()
    to_unicode_stream.set_data(_build_to_unicode_cmap(cjk_codepoints))
    to_unicode_ref = writer._add_object(to_unicode_stream)

    type0_font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type0"),
            NameObject("/BaseFont"): NameObject("/STSong-Light"),
            NameObject("/Encoding"): NameObject("/UniGB-UCS2-H"),
            NameObject("/DescendantFonts"): ArrayObject([desc_font_ref]),
            NameObject("/ToUnicode"): to_unicode_ref,
        }
    )
    cjk_font_ref = writer._add_object(type0_font)
    return {"latin": latin_font_ref, "cjk": cjk_font_ref}


def _attach_font_to_page(page: Any, font_refs: dict[str, Any]) -> None:
    from PyPDF2.generic import DictionaryObject, IndirectObject, NameObject

    resources = page.get("/Resources")
    if resources is None:
        resources = DictionaryObject()
        page[NameObject("/Resources")] = resources
    elif isinstance(resources, IndirectObject):
        resources = resources.get_object()

    fonts = resources.get("/Font")
    if fonts is None:
        fonts = DictionaryObject()
        resources[NameObject("/Font")] = fonts
    elif isinstance(fonts, IndirectObject):
        fonts = fonts.get_object()

    fonts[NameObject("/FOCRL")] = font_refs["latin"]
    fonts[NameObject("/FOCRC")] = font_refs["cjk"]


def _append_page_stream(writer: Any, page: Any, stream_data: bytes) -> None:
    from PyPDF2.generic import ArrayObject, DecodedStreamObject, IndirectObject, NameObject

    overlay = DecodedStreamObject()
    overlay.set_data(stream_data)
    overlay_ref = writer._add_object(overlay)

    contents = page.get("/Contents")
    if contents is None:
        page[NameObject("/Contents")] = overlay_ref
        return

    if isinstance(contents, IndirectObject):
        contents_obj = contents.get_object()
    else:
        contents_obj = contents

    if isinstance(contents_obj, ArrayObject):
        contents_obj.append(overlay_ref)
    else:
        page[NameObject("/Contents")] = ArrayObject([contents, overlay_ref])


def _build_page_text_stream(
    blocks: list[dict[str, Any]],
    page_width_pt: float,
    page_height_pt: float,
    canvas_width: float | None,
    canvas_height: float | None,
    text_mode: str,
    min_font_size: float,
    max_font_size: float,
) -> bytes:
    if not blocks:
        return b""

    sx = page_width_pt / canvas_width if canvas_width and canvas_width > 0 else 1.0
    sy = page_height_pt / canvas_height if canvas_height and canvas_height > 0 else 1.0
    render_mode = "3" if text_mode == "hidden" else "0"

    chunks: list[str] = []
    def _escape_pdf_literal(text: str) -> str:
        return (
            text.replace("\\", "\\\\")
            .replace("(", "\\(")
            .replace(")", "\\)")
            .replace("\n", " ")
            .replace("\r", " ")
            .replace("\t", " ")
        )

    for block in sorted(blocks, key=lambda item: (item.get("bbox", [0, 0, 0, 0])[1], item.get("bbox", [0, 0, 0, 0])[0])):
        bbox = block.get("bbox")
        if not (isinstance(bbox, list) and len(bbox) == 4):
            continue

        try:
            x1, y1, x2, y2 = [float(v) for v in bbox]
        except (TypeError, ValueError):
            continue
        if x2 <= x1 or y2 <= y1:
            continue

        text = _normalize_block_text(str(block.get("block_content") or ""))
        if not text:
            continue

        box_w = max(1.0, (x2 - x1) * sx)
        box_h = max(min_font_size * 1.2, (y2 - y1) * sy)
        font_size, lines = _fit_text_to_box(
            text=text,
            box_width=box_w,
            box_height=box_h,
            min_font_size=min_font_size,
            max_font_size=max_font_size,
        )
        if not lines:
            continue

        line_h = font_size * 1.2
        start_x = x1 * sx
        start_y_top = y1 * sy

        for idx, line in enumerate(lines):
            y = page_height_pt - start_y_top - font_size - idx * line_h
            if y < -font_size:
                break
            is_ascii = all(ord(ch) < 128 for ch in line)
            if is_ascii:
                escaped = _escape_pdf_literal(line)
                if not escaped:
                    continue
                chunks.append(
                    "BT\n"
                    f"/FOCRL {font_size:.2f} Tf\n"
                    f"{render_mode} Tr\n"
                    f"1 0 0 1 {start_x:.2f} {y:.2f} Tm\n"
                    f"({escaped}) Tj\n"
                    "ET\n"
                )
            else:
                cjk_line = "".join(ch for ch in line if 0x20 <= ord(ch) <= 0xFFFF)
                if not cjk_line:
                    continue
                hex_text = cjk_line.encode("utf-16-be").hex().upper()
                if not hex_text:
                    continue
                chunks.append(
                    "BT\n"
                    f"/FOCRC {font_size:.2f} Tf\n"
                    f"{render_mode} Tr\n"
                    f"1 0 0 1 {start_x:.2f} {y:.2f} Tm\n"
                    f"<{hex_text}> Tj\n"
                    "ET\n"
                )

    return "".join(chunks).encode("ascii")


def create_searchable_pdf(
    input_pdf: Path,
    output_pdf: Path,
    layout_blocks: list[dict[str, Any]],
    page_start: int,
    page_end: int,
    canvas_width: float | None,
    canvas_height: float | None,
    text_mode: str = "hidden",
    min_font_size: float = 4.0,
    max_font_size: float = 24.0,
) -> tuple[int, int]:
    PdfReader, PdfWriter = require_pypdf2()
    reader = PdfReader(str(input_pdf))
    writer = PdfWriter()
    cjk_codepoints = _collect_cjk_codepoints(
        layout_blocks=layout_blocks,
        page_start=page_start,
        page_end=page_end,
    )
    font_refs = _ensure_ocr_fonts(writer, cjk_codepoints=cjk_codepoints)

    blocks_by_page: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for block in layout_blocks:
        page_index = block.get("page_index")
        if isinstance(page_index, str) and page_index.isdigit():
            page_index = int(page_index)
        if isinstance(page_index, int):
            blocks_by_page[page_index].append(block)

    pages_with_text = 0
    total_blocks = 0
    for page_idx in range(page_start, page_end + 1):
        writer.add_page(reader.pages[page_idx - 1])
        page = writer.pages[-1]

        page_width_pt = float(page.mediabox.width)
        page_height_pt = float(page.mediabox.height)
        blocks = blocks_by_page.get(page_idx, [])
        stream = _build_page_text_stream(
            blocks=blocks,
            page_width_pt=page_width_pt,
            page_height_pt=page_height_pt,
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            text_mode=text_mode,
            min_font_size=min_font_size,
            max_font_size=max_font_size,
        )
        if stream:
            _attach_font_to_page(page=page, font_refs=font_refs)
            _append_page_stream(writer=writer, page=page, stream_data=stream)
            pages_with_text += 1
            total_blocks += len(blocks)

    with output_pdf.open("wb") as f:
        writer.write(f)

    return pages_with_text, total_blocks


def split_pdf(
    input_pdf: Path,
    output_dir: Path,
    pages_per_chunk: int,
    page_start: int,
    page_end: int | None,
) -> tuple[int, int, int, list[ChunkTask]]:
    PdfReader, PdfWriter = require_pypdf2()

    if pages_per_chunk <= 0:
        raise ValueError("pages_per_chunk 必须大于 0")

    reader = PdfReader(str(input_pdf))
    total_pages = len(reader.pages)
    if total_pages == 0:
        raise ValueError("输入 PDF 没有可处理页面")

    start = max(1, page_start)
    end = total_pages if page_end is None else min(total_pages, page_end)
    if start > end:
        raise ValueError(f"无效页码范围: start={start}, end={end}")

    chunks: list[ChunkTask] = []
    chunk_idx = 0

    for start_idx in range(start - 1, end, pages_per_chunk):
        end_idx = min(start_idx + pages_per_chunk - 1, end - 1)
        writer = PdfWriter()
        for p in range(start_idx, end_idx + 1):
            writer.add_page(reader.pages[p])

        chunk_idx += 1
        chunk_file = output_dir / (
            f"{input_pdf.stem}.chunk-{chunk_idx:04d}.p{start_idx + 1:04d}-p{end_idx + 1:04d}.pdf"
        )
        with chunk_file.open("wb") as f:
            writer.write(f)

        chunks.append(
            ChunkTask(
                index=chunk_idx,
                start_page=start_idx + 1,
                end_page=end_idx + 1,
                file_path=chunk_file,
            )
        )

    selected_pages = end - start + 1
    return total_pages, start, end, chunks


async def fetch_workers_count(client: Any, backend_url: str) -> int | None:
    try:
        resp = await client.get(f"{backend_url}/api/v1/system/health", timeout=10.0)
        resp.raise_for_status()
        payload = resp.json()
        workers = payload.get("workers_count")
        if isinstance(workers, int) and workers > 0:
            return workers
    except Exception:
        return None
    return None


async def submit_chunk(
    client: Any,
    backend_url: str,
    chunk: ChunkTask,
    processing_mode: str,
    priority: int,
    output_format: str,
    custom_url: str | None,
    request_timeout: float,
) -> None:
    data = {
        "processing_mode": processing_mode,
        "priority": str(priority),
        "output_format": output_format,
    }
    if custom_url:
        data["custom_url"] = custom_url

    file_handle = chunk.file_path.open("rb")
    files = {"file": (chunk.file_path.name, file_handle, "application/pdf")}
    try:
        resp = await client.post(
            f"{backend_url}/api/v1/tasks/upload",
            data=data,
            files=files,
            timeout=request_timeout,
        )
    finally:
        file_handle.close()

    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("success"):
        raise RuntimeError(payload.get("message") or "提交任务失败")

    task_id = payload.get("data", {}).get("task_id")
    if not task_id:
        raise RuntimeError(f"提交返回中缺少 task_id: {payload}")

    chunk.task_id = str(task_id)


async def wait_chunk_done(
    client: Any,
    backend_url: str,
    chunk: ChunkTask,
    poll_interval: float,
    max_wait_seconds: int,
) -> None:
    if not chunk.task_id:
        raise RuntimeError("task_id 不存在，无法轮询")

    start = time.monotonic()
    while True:
        resp = await client.get(
            f"{backend_url}/api/v1/tasks/{chunk.task_id}",
            timeout=30.0,
        )
        resp.raise_for_status()
        payload = resp.json()
        if not payload.get("success"):
            raise RuntimeError(payload.get("message") or "查询任务状态失败")

        data = payload.get("data") or {}
        status = str(data.get("status", "")).lower()
        progress = data.get("progress")
        if isinstance(progress, (int, float)):
            chunk.progress = float(progress)

        if status in {"completed", "failed", "cancelled"}:
            chunk.status = status
            if status == "completed":
                chunk.result = data
            else:
                chunk.error = data.get("error_message") or f"任务状态={status}"
            return

        if max_wait_seconds > 0 and (time.monotonic() - start) > max_wait_seconds:
            chunk.status = "timeout"
            chunk.error = f"超过最大等待时间 {max_wait_seconds}s"
            return

        await asyncio.sleep(poll_interval)


def merge_results(chunks: list[ChunkTask]) -> tuple[str, list[dict[str, Any]]]:
    ordered = sorted(chunks, key=lambda c: c.start_page)
    markdown_parts: list[str] = []
    layout_all: list[dict[str, Any]] = []

    for chunk in ordered:
        result = chunk.result or {}
        chunk_md = str(result.get("full_markdown") or "").strip()
        if chunk_md:
            markdown_parts.append(f"\n\n<!-- pages {chunk.start_page}-{chunk.end_page} -->\n\n")
            markdown_parts.append(chunk_md)
            markdown_parts.append("\n")

        chunk_layout = result.get("layout")
        if isinstance(chunk_layout, list):
            for block in chunk_layout:
                if not isinstance(block, dict):
                    continue
                item = dict(block)
                page_idx = item.get("page_index")
                if isinstance(page_idx, int):
                    item["page_index"] = page_idx + chunk.start_page - 1
                elif isinstance(page_idx, str) and page_idx.isdigit():
                    item["page_index"] = int(page_idx) + chunk.start_page - 1
                layout_all.append(item)

    return "".join(markdown_parts).lstrip(), layout_all


def build_manifest(chunks: list[ChunkTask]) -> dict[str, Any]:
    return {
        "chunks": [
            {
                **asdict(chunk),
                "file_path": str(chunk.file_path),
                "result": None,
            }
            for chunk in sorted(chunks, key=lambda c: c.index)
        ]
    }


async def run(args: argparse.Namespace) -> int:
    httpx = require_httpx()

    input_pdf = Path(args.pdf).expanduser().resolve()
    if not input_pdf.exists() or not input_pdf.is_file():
        raise FileNotFoundError(f"输入 PDF 不存在: {input_pdf}")
    if args.searchable_min_font_size <= 0:
        raise ValueError("--searchable-min-font-size 必须大于 0")
    if args.searchable_max_font_size < args.searchable_min_font_size:
        raise ValueError("--searchable-max-font-size 不能小于最小字号")

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.from_result_json:
        result_json_path = Path(args.from_result_json).expanduser().resolve()
        if not result_json_path.exists() or not result_json_path.is_file():
            raise FileNotFoundError(f"--from-result-json 文件不存在: {result_json_path}")

        data = json.loads(result_json_path.read_text(encoding="utf-8"))
        layout_blocks = data.get("layout")
        if not isinstance(layout_blocks, list):
            raise ValueError(f"result json 缺少 layout 数组: {result_json_path}")

        PdfReader, _ = require_pypdf2()
        reader = PdfReader(str(input_pdf))
        total_pages = len(reader.pages)
        page_start = max(1, args.page_start)
        if args.page_end > 0:
            page_end = min(total_pages, args.page_end)
        else:
            page_range = data.get("page_range")
            if isinstance(page_range, dict) and isinstance(page_range.get("end"), int):
                page_end = min(total_pages, int(page_range["end"]))
            else:
                page_end = total_pages
        if page_start > page_end:
            raise ValueError(f"无效页码范围: start={page_start}, end={page_end}")

        canvas_width = None
        canvas_height = None
        ocr_canvas = data.get("ocr_canvas")
        if isinstance(ocr_canvas, dict):
            w = ocr_canvas.get("width")
            h = ocr_canvas.get("height")
            if isinstance(w, (int, float)) and isinstance(h, (int, float)):
                canvas_width = float(w)
                canvas_height = float(h)
        if canvas_width is None or canvas_height is None:
            canvas_width, canvas_height = _infer_canvas_from_layout(layout_blocks)

        if not args.searchable_pdf:
            log("已指定 --no-searchable-pdf，离线模式无需执行，结束")
            return 0

        searchable_pdf_path = output_dir / args.searchable_pdf_name
        pages_with_text, total_blocks = create_searchable_pdf(
            input_pdf=input_pdf,
            output_pdf=searchable_pdf_path,
            layout_blocks=layout_blocks,
            page_start=page_start,
            page_end=page_end,
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            text_mode=args.searchable_text_mode,
            min_font_size=args.searchable_min_font_size,
            max_font_size=args.searchable_max_font_size,
        )
        log(
            f"离线模式完成: result_json={result_json_path} -> {searchable_pdf_path} "
            f"(pages_with_text={pages_with_text}, blocks={total_blocks}, mode={args.searchable_text_mode})"
        )
        return 0

    backend_url = args.backend_url.rstrip("/")

    async with httpx.AsyncClient() as client:
        worker_count = await fetch_workers_count(client, backend_url)

    PdfReader, _ = require_pypdf2()
    reader = PdfReader(str(input_pdf))
    total_pages = len(reader.pages)
    page_start = max(1, args.page_start)
    page_end = total_pages if args.page_end <= 0 else min(args.page_end, total_pages)
    selected_pages = page_end - page_start + 1
    if selected_pages <= 0:
        raise ValueError(f"无效页码范围: start={page_start}, end={page_end}")

    if args.pages_per_chunk > 0:
        pages_per_chunk = args.pages_per_chunk
    else:
        workers = worker_count or args.default_workers
        pages_per_chunk = max(1, math.ceil(selected_pages / max(1, workers)))

    if args.keep_chunks:
        chunks_dir = output_dir / "chunks"
        chunks_dir.mkdir(parents=True, exist_ok=True)
        temp_ctx = None
    else:
        temp_ctx = tempfile.TemporaryDirectory(prefix="batch-pdf-ocr-")
        chunks_dir = Path(temp_ctx.name)

    log(
        f"输入页数={total_pages}, 处理范围={page_start}-{page_end}, "
        f"workers={worker_count or 'unknown'}, pages_per_chunk={pages_per_chunk}"
    )

    try:
        _, start, end, chunks = split_pdf(
            input_pdf=input_pdf,
            output_dir=chunks_dir,
            pages_per_chunk=pages_per_chunk,
            page_start=page_start,
            page_end=page_end,
        )

        log(f"已切分为 {len(chunks)} 个 chunk，开始提交任务")

        async with httpx.AsyncClient() as client:
            for chunk in chunks:
                await submit_chunk(
                    client=client,
                    backend_url=backend_url,
                    chunk=chunk,
                    processing_mode=args.processing_mode,
                    priority=args.priority,
                    output_format=args.output_format,
                    custom_url=args.custom_url,
                    request_timeout=args.submit_timeout,
                )
                log(
                    f"chunk {chunk.index}/{len(chunks)} "
                    f"pages={chunk.start_page}-{chunk.end_page} -> task_id={chunk.task_id}"
                )

            log("所有 chunk 已提交，开始并发轮询任务状态")
            sem = asyncio.Semaphore(max(1, args.poll_concurrency))

            async def _poll(chunk: ChunkTask) -> None:
                async with sem:
                    await wait_chunk_done(
                        client=client,
                        backend_url=backend_url,
                        chunk=chunk,
                        poll_interval=args.poll_interval,
                        max_wait_seconds=args.max_wait_seconds,
                    )
                    log(
                        f"task={chunk.task_id} status={chunk.status} "
                        f"progress={chunk.progress if chunk.progress is not None else 'n/a'}"
                    )

            await asyncio.gather(*(_poll(c) for c in chunks))

        failed = [c for c in chunks if c.status != "completed"]
        manifest = build_manifest(chunks)
        manifest.update(
            {
                "source_pdf": str(input_pdf),
                "backend_url": backend_url,
                "created_at": datetime.now(UTC).isoformat(),
                "page_range": {"start": start, "end": end, "total": end - start + 1},
                "chunk_count": len(chunks),
            }
        )

        manifest_path = output_dir / args.manifest_name
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        if failed:
            raise RuntimeError(
                "存在失败任务: "
                + ", ".join(
                    f"task_id={c.task_id},pages={c.start_page}-{c.end_page},reason={c.error}"
                    for c in failed
                )
            )

        merged_markdown, merged_layout = merge_results(chunks)
        canvas_width, canvas_height = _infer_ocr_canvas_size(chunks)

        markdown_path = output_dir / args.markdown_name
        markdown_path.write_text(merged_markdown, encoding="utf-8")

        merged_json = {
            "source_pdf": str(input_pdf),
            "backend_url": backend_url,
            "created_at": datetime.now(UTC).isoformat(),
            "page_range": {
                "start": page_start,
                "end": page_end,
                "total": selected_pages,
            },
            "chunk_count": len(chunks),
            "ocr_canvas": {
                "width": canvas_width,
                "height": canvas_height,
            },
            "full_markdown": merged_markdown,
            "layout": merged_layout,
            "chunks": [
                {
                    "index": c.index,
                    "task_id": c.task_id,
                    "status": c.status,
                    "start_page": c.start_page,
                    "end_page": c.end_page,
                    "page_count": c.page_count,
                }
                for c in sorted(chunks, key=lambda item: item.index)
            ],
        }

        json_path = output_dir / args.json_name
        json_path.write_text(
            json.dumps(merged_json, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        searchable_pdf_path: Path | None = None
        if args.searchable_pdf:
            searchable_pdf_path = output_dir / args.searchable_pdf_name
            pages_with_text, total_blocks = create_searchable_pdf(
                input_pdf=input_pdf,
                output_pdf=searchable_pdf_path,
                layout_blocks=merged_layout,
                page_start=page_start,
                page_end=page_end,
                canvas_width=canvas_width,
                canvas_height=canvas_height,
                text_mode=args.searchable_text_mode,
                min_font_size=args.searchable_min_font_size,
                max_font_size=args.searchable_max_font_size,
            )
            log(
                f"Searchable PDF: {searchable_pdf_path} "
                f"(pages_with_text={pages_with_text}, blocks={total_blocks}, mode={args.searchable_text_mode})"
            )

        log("处理完成")
        log(f"Markdown: {markdown_path}")
        log(f"JSON: {json_path}")
        log(f"Manifest: {manifest_path}")
        if searchable_pdf_path is not None:
            log(f"Searchable PDF 输出: {searchable_pdf_path}")
        return 0

    finally:
        if temp_ctx is not None:
            temp_ctx.cleanup()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="将大 PDF 切块后并发提交到 GLM-OCR backend，加速批量识别",
    )
    parser.add_argument("pdf", help="输入 PDF 路径")

    parser.add_argument(
        "--backend-url",
        default="http://localhost:8000",
        help="backend 地址，默认: http://localhost:8000",
    )
    parser.add_argument(
        "--output-dir",
        default="./runtime/batch-output",
        help="输出目录",
    )
    parser.add_argument(
        "--from-result-json",
        default=None,
        help="离线模式：基于已有 result.json 直接生成 searchable PDF（不重新发起 OCR）",
    )

    parser.add_argument(
        "--page-start",
        type=int,
        default=1,
        help="起始页(1-based)，默认 1",
    )
    parser.add_argument(
        "--page-end",
        type=int,
        default=0,
        help="结束页(1-based，含)，默认 0 表示最后一页",
    )
    parser.add_argument(
        "--pages-per-chunk",
        type=int,
        default=0,
        help="每个 chunk 页数；默认自动按 worker 数估算",
    )
    parser.add_argument(
        "--default-workers",
        type=int,
        default=5,
        help="当无法读取 system/health 时用于估算 chunk 的 worker 数",
    )

    parser.add_argument(
        "--processing-mode",
        default="pipeline",
        help="任务处理模式，默认 pipeline",
    )
    parser.add_argument(
        "--priority",
        type=int,
        default=2,
        help="任务优先级 1-4，默认 2",
    )
    parser.add_argument(
        "--output-format",
        default="markdown",
        help="backend 任务输出格式，默认 markdown",
    )
    parser.add_argument(
        "--custom-url",
        default=None,
        help="可选，自定义 OCR URL，透传给 /tasks/upload 的 custom_url",
    )

    parser.add_argument(
        "--poll-interval",
        type=float,
        default=2.0,
        help="轮询间隔(秒)",
    )
    parser.add_argument(
        "--poll-concurrency",
        type=int,
        default=8,
        help="并发轮询数",
    )
    parser.add_argument(
        "--submit-timeout",
        type=float,
        default=300.0,
        help="上传超时(秒)",
    )
    parser.add_argument(
        "--max-wait-seconds",
        type=int,
        default=0,
        help="单任务最大等待秒数，0 表示无限制",
    )

    parser.add_argument(
        "--markdown-name",
        default="result.md",
        help="合并 Markdown 输出文件名",
    )
    parser.add_argument(
        "--json-name",
        default="result.json",
        help="合并 JSON 输出文件名",
    )
    parser.add_argument(
        "--manifest-name",
        default="manifest.json",
        help="任务映射清单文件名",
    )
    parser.add_argument(
        "--searchable-pdf",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="是否输出可搜索/可复制文本层 PDF（默认开启）",
    )
    parser.add_argument(
        "--searchable-pdf-name",
        default="result.searchable.pdf",
        help="可搜索 PDF 输出文件名",
    )
    parser.add_argument(
        "--searchable-text-mode",
        choices=("hidden", "visible"),
        default="hidden",
        help="文本层模式：hidden=隐藏文本层，visible=可见文本层",
    )
    parser.add_argument(
        "--searchable-min-font-size",
        type=float,
        default=4.0,
        help="文本层最小字号",
    )
    parser.add_argument(
        "--searchable-max-font-size",
        type=float,
        default=24.0,
        help="文本层最大字号",
    )
    parser.add_argument(
        "--keep-chunks",
        action="store_true",
        help="保留中间切分 PDF（默认处理完成后清理）",
    )

    return parser.parse_args()


def main() -> int:
    args = parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
