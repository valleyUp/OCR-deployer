#!/usr/bin/env python3
"""
批量将 Word DOCX 中的图片三线表转换为 Word 实际表格。

工作原理：
1. 解析 DOCX 文件，提取 word/media/ 下的所有 PNG/JPG 图片
2. 优先按正文结构定位“表注 + 下方图片”，避免把正文中的图/表引用误判为 OCR 对象
3. 将候选图片提交到 OCR pipeline 服务进行 layout 识别
4. 从 OCR 结果中提取 label="table" 的 block，获取 HTML 表格内容
5. 将 HTML 表格转换为最小 OOXML 表格，后续格式化交给 normalize_docx_academic_format.py
6. 在 document.xml 中用 w:tbl 替换原来的 w:drawing 元素
7. 保存修改后的 DOCX 文件

依赖：
    pip install lxml   # 如果不可用会自动回退到标准库 ElementTree

用法：
    python scripts/convert-docx-tables.py input.docx
    python scripts/convert-docx-tables.py input.docx -o output.docx
    python scripts/convert-docx-tables.py --all-images input.docx  # 处理全部图片
    python scripts/convert-docx-tables.py --dry-run input.docx      # 仅分析不替换

OCR 服务连接：
    默认通过 backend API 提交任务 (http://localhost:8000)
    可通过 --pipeline-url 直接调用 pipeline (http://localhost:5002)
"""

from __future__ import annotations

import argparse
import base64
import copy
import dataclasses
import html.parser
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
try:
    from lxml import etree as ET
    HAS_LXML = True
except ImportError:
    from xml.etree import ElementTree as ET
    HAS_LXML = False

# XML namespace for xml:space
XML_NS = "http://www.w3.org/XML/1998/namespace"

# ── constants ────────────────────────────────────────────────────────────────

# Table area threshold in EMUs² (English Metric Units)
# 1 inch = 914400 EMU. 5.77in × 3.77in ≈ 21.8 EMUs²×1e12
# Empirical threshold from the sample document: real tables are >5 in²
MIN_TABLE_AREA_EMU2 = 4.0 * 914400 * 914400  # ~4 in²
MIN_TABLE_WIDTH_EMU = 2.5 * 914400
MIN_TABLE_HEIGHT_EMU = 0.3 * 914400

# OOXML namespaces
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
V = "urn:schemas-microsoft-com:vml"

NSMAP = {
    "w": W,
    "wp": WP,
    "a": A,
    "r": R_NS,
    "mc": MC,
    "v": V,
}

SUPPORTED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}

TABLE_CAPTION_STYLE_IDS = {
    "CaptionTable",
    "TableCaption",
}
GENERIC_CAPTION_STYLE_IDS = {
    "Caption",
    "af8",
}
FIGURE_CAPTION_STYLE_IDS = {
    "CaptionFigureAlgorithm",
}


@dataclasses.dataclass(frozen=True)
class ImageCaptionContext:
    """A document image selected because it is structurally below a table caption."""

    rid: str
    caption_text: str
    image_index: int
    caption_index: int
    block_index: int


# ── HTML table parser ────────────────────────────────────────────────────────

class HTMLTableParser(html.parser.HTMLParser):
    """将 HTML <table> 解析为二维单元格网格。"""

    def __init__(self) -> None:
        super().__init__()
        self.tables: List[TableGrid] = []
        self._current: Optional[TableGrid] = None
        self._row: List[CellData] = []
        self._cell: Optional[CellData] = None
        self._text: List[str] = []
        self._depth = 0
        self._rowspan_tracker: Dict[int, Dict[int, int]] = {}

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, str]]) -> None:
        a = dict(attrs)
        if tag == "table":
            self._depth += 1
            if self._depth == 1:
                self._current = TableGrid()
                self._rowspan_tracker = {}
        elif tag == "tr" and self._current is not None:
            self._row = []
        elif tag in ("td", "th") and self._current is not None:
            rs = int(a.get("rowspan", 1))
            cs = int(a.get("colspan", 1))
            self._cell = CellData(rowspan=rs, colspan=cs)
            self._text = []
        elif tag in ("br",) and self._cell is not None:
            self._text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "table":
            if self._depth == 1 and self._current is not None:
                self._current._normalize()
                self.tables.append(self._current)
                self._current = None
            self._depth = max(0, self._depth - 1)
        elif tag in ("td", "th") and self._cell is not None:
            self._cell.text = "".join(self._text).strip()
            self._row.append(self._cell)
            self._cell = None
            self._text = []
        elif tag == "tr" and self._current is not None:
            if self._row:
                self._current.rows.append(self._row)
            self._row = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._text.append(data)


class CellData:
    __slots__ = ("rowspan", "colspan", "text")
    def __init__(self, rowspan: int = 1, colspan: int = 1, text: str = "") -> None:
        self.rowspan = rowspan
        self.colspan = colspan
        self.text = text


class TableGrid:
    """二维表格网格 - 预计算归一化物理网格，正确处理 rowspan/colspan。

    归一化后得到一个 M×N 矩阵，每个位置要么是一个 CellData 引用，
    要么是 None（被上方 rowspan 覆盖）。
    property 直接返回该维度并可被 build_ooxml_table 安全迭代。
    """

    def __init__(self) -> None:
        self.rows: List[List[CellData]] = []
        # 归一化后的物理网格: grid[r][c] 为 CellData 或 None
        self.grid: List[List[Optional[CellData]]] = []
        self._col_count: int = 0

    def _normalize(self) -> None:
        """展开 rowspan/colspan，构建规整的 M×N 物理网格。"""
        if not self.rows:
            self.grid = []
            self._col_count = 0
            return

        # 计算物理列数 = 最宽行的 colpos 总和
        max_cols = 0
        for row in self.rows:
            w = sum(c.colspan for c in row)
            if w > max_cols:
                max_cols = w
        self._col_count = max_cols

        # 构建归一化网格
        self.grid = []
        # 追踪哪些物理列在当前行被上方 rowspan 占用
        occupied: List[int] = []  # 每行记录的占位列

        for ri, row in enumerate(self.rows):
            grid_row: List[Optional[CellData]] = [None] * max_cols
            col_pos = 0

            for cell in row:
                # 跳过已被上方 rowspan 占用的物理列
                while col_pos < max_cols and self._is_covered(ri, col_pos):
                    col_pos += 1
                if col_pos >= max_cols:
                    break

                # 填充 cell 到当前 col_pos 开始的 colspan 个位置
                for dc in range(cell.colspan):
                    if col_pos + dc < max_cols:
                        grid_row[col_pos + dc] = cell

                col_pos += cell.colspan

            self.grid.append(grid_row)

    def _is_covered(self, r: int, c: int) -> bool:
        """物理列 c 在行 r 是否被上方的 rowspan 覆盖。"""
        for pr in range(r - 1, -1, -1):
            if pr >= len(self.grid):
                continue
            prev_row = self.grid[pr]
            if c >= len(prev_row):
                continue
            prev_cell = prev_row[c]
            if prev_cell is not None:
                return pr + prev_cell.rowspan > r
        return False

    @property
    def col_count(self) -> int:
        return self._col_count

    @property
    def row_count(self) -> int:
        return len(self.rows)

    def cell_at(self, r: int, c: int) -> Optional[CellData]:
        """获取归一化网格中 (r, c) 的 CellData。"""
        if r < 0 or r >= len(self.grid):
            return None
        row = self.grid[r]
        if c < 0 or c >= len(row):
            return None
        return row[c]

    def is_spanned(self, r: int, c: int) -> bool:
        """位置 (r, c) 是否被上方 rowspan 占据(应跳过，不生成新单元格)。"""
        cell = self.cell_at(r, c)
        if cell is None:
            return True  # 空位 = 被 rowspan 覆盖
        # 如果当前位置的 cell 实际"起始位置"在前面的列，这是 colspan 展开的副本
        # 需要检查该 cell 在当前行是否是新起始（rowspan restart）
        if r > 0:
            above = self.cell_at(r - 1, c)
            if above is not None and above is cell:
                return True  # 同一个 cell 对象在上行已出现过 = vMerge continue
            if above is not None and above.rowspan > 1:
                return True  # 上方 cell 的 rowspan 覆盖此处
        return False

    def is_vmerge_restart(self, r: int, c: int) -> bool:
        """该位置的 cell 是否应标记为 vMerge=restart。"""
        cell = self.cell_at(r, c)
        if cell is None or cell.rowspan <= 1:
            return False
        # 检查该 cell 是否在当前位置首次出现（不是从上方延续下来的）
        if r == 0:
            return True
        # 检查上方行同列是否是不同的 cell
        above = self.cell_at(r - 1, c)
        return above is not cell


def parse_html_tables(html_content: str) -> List[TableGrid]:
    """解析 HTML 字符串中的全部表格。"""
    parser = HTMLTableParser()
    parser.feed(html_content)
    return parser.tables


# ── OOXML table builder ──────────────────────────────────────────────────────

def _el(tag: str, ns: str = W, attrib: Optional[Dict[str, str]] = None, text: str = "") -> ET.Element:
    """创建带命名空间的元素。"""
    el = ET.Element(f"{{{ns}}}{tag}", attrib=attrib or {})
    if text:
        el.text = text
    return el


def _sub(parent: ET.Element, tag: str, ns: str = W, attrib: Optional[Dict[str, str]] = None, text: str = "") -> ET.Element:
    """添加子元素。"""
    child = _el(tag, ns, attrib, text)
    parent.append(child)
    return child


def _build_paragraph(text: str) -> ET.Element:
    """将文本构建为 w:p 元素。"""
    p = _el("p")
    if text:
        r = _sub(p, "r")
        t = _sub(r, "t", text=text)
        t.set(f"{{{XML_NS}}}space", "preserve")
    return p


def _build_empty_paragraph() -> ET.Element:
    return _build_paragraph("")


def build_ooxml_table(table: TableGrid) -> ET.Element:
    """将 TableGrid 转换为最小 OOXML w:tbl 元素。

    这里只做 OCR 结果的结构替换，不设置三线表、字体、居中或窗口宽度；
    这些统一交给 normalize_docx_academic_format.py 处理。
    """
    tbl = _el("tbl")
    col_count = table.col_count

    # ── table properties: minimal auto width ──
    tbl_pr = _sub(tbl, "tblPr")
    _sub(tbl_pr, "tblW", attrib={
        f"{{{W}}}w": "0",
        f"{{{W}}}type": "auto",
    })

    # ── grid ──
    tbl_grid = _sub(tbl, "tblGrid")
    col_width = 9026 // max(col_count, 1)  # A4 usable width in twips (~6.3in)
    for _ in range(col_count):
        _sub(tbl_grid, "gridCol", attrib={f"{{{W}}}w": str(col_width)})

    # ── rows (iterate normalized physical grid) ──
    for ri in range(table.row_count):
        tr = _sub(tbl, "tr")
        seen: set[int] = set()  # track cell id() to skip colspan duplicates

        for ci in range(col_count):
            cell = table.cell_at(ri, ci)
            if cell is None:
                # Position filled by rowspan from above
                tc = _sub(tr, "tc")
                tc_pr = _sub(tc, "tcPr")
                _sub(tc_pr, "vMerge", attrib={f"{{{W}}}val": "continue"})
                tc.append(_build_empty_paragraph())
                continue

            cell_id = id(cell)
            if cell_id in seen:
                # colspan: same cell fills multiple grid columns
                continue
            seen.add(cell_id)

            tc = _sub(tr, "tc")
            tc_pr = _sub(tc, "tcPr")

            if cell.colspan > 1:
                _sub(tc_pr, "gridSpan", attrib={f"{{{W}}}val": str(cell.colspan)})

            if cell.rowspan > 1:
                _sub(tc_pr, "vMerge", attrib={f"{{{W}}}val": "restart"})

            text = cell.text.strip()
            tc.append(_build_paragraph(text) if text else _build_empty_paragraph())

    return tbl


def summarize_table_grid(table: TableGrid) -> str:
    """Short OCR table summary for audit logs."""
    first_row = table.rows[0] if table.rows else []
    preview_parts = [
        _normalize_space(cell.text)
        for cell in first_row
        if _normalize_space(cell.text)
    ]
    preview = " | ".join(preview_parts)
    if len(preview) > 120:
        preview = preview[:117] + "..."
    return f"{table.row_count}x{table.col_count}" + (f'; first row: "{preview}"' if preview else "")


# ── API helpers ──────────────────────────────────────────────────────────────

class OCRClient:
    """OCR 服务客户端，支持 backend task API 和 pipeline 直连两种模式。"""

    def __init__(self, backend_url: str = "http://localhost:8000",
                 pipeline_url: str = "http://localhost:5002/glmocr/parse",
                 use_pipeline_direct: bool = False,
                 insecure: bool = False,
                 timeout: int = 300) -> None:
        self.backend_url = backend_url.rstrip("/")
        self.pipeline_url = pipeline_url
        self.use_pipeline_direct = use_pipeline_direct
        self.insecure = insecure
        self.timeout = timeout
        self._ctx = None
        if insecure:
            import ssl
            self._ctx = ssl.create_default_context()
            self._ctx.check_hostname = False
            self._ctx.verify_mode = ssl.CERT_NONE

    def _request(self, url: str, data: Optional[bytes] = None,
                 headers: Optional[Dict[str, str]] = None,
                 method: str = "GET") -> urllib.request.Request:
        req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
        return urllib.request.urlopen(req, timeout=self.timeout, context=self._ctx)

    def process_image(self, image_path: str) -> List[Dict[str, Any]]:
        """通过 pipeline 直接处理一张图片，返回 layout blocks。"""
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        ext = Path(image_path).suffix.lower()
        mime = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".bmp": "image/bmp", ".webp": "image/webp",
        }.get(ext, "image/png")

        payload = json.dumps({
            "images": [f"data:{mime};base64,{image_data}"],
            "processing_mode": "pipeline",
        }).encode("utf-8")

        resp = self._request(
            self.pipeline_url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        result = json.loads(resp.read())

        json_result = result.get("json_result", [])
        if isinstance(json_result, str):
            json_result = json.loads(json_result)
        if isinstance(json_result, list) and len(json_result) > 0:
            first_page = json_result[0]
            if isinstance(first_page, list):
                return first_page
        return []

    def process_image_via_backend(self, image_path: str) -> List[Dict[str, Any]]:
        """通过 backend task API 处理一张图片(提交-轮询-获取结果)。"""
        import email.mime.application
        import email.mime.multipart
        import email.mime.base
        import email.mime.text

        # Build multipart form
        boundary = "----FormBoundary" + os.urandom(16).hex()
        with open(image_path, "rb") as f:
            file_data = f.read()

        filename = Path(image_path).name
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8") + file_data + (
            f"\r\n--{boundary}\r\n"
            f'Content-Disposition: form-data; name="processing_mode"\r\n\r\n'
            f"pipeline\r\n"
            f"--{boundary}--\r\n"
        ).encode("utf-8")

        # Upload
        resp = self._request(
            f"{self.backend_url}/api/v1/tasks/upload",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        upload_result = json.loads(resp.read())
        task_id = upload_result["data"]["task_id"]

        # Poll until done
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            resp = self._request(f"{self.backend_url}/api/v1/tasks/{task_id}")
            status = json.loads(resp.read())
            task_status = status["data"]["status"]
            if task_status in ("completed", "failed", "cancelled"):
                if task_status == "completed":
                    layout = status["data"].get("layout", [])
                    if isinstance(layout, str):
                        layout = json.loads(layout)
                    return layout if isinstance(layout, list) else []
                return []
            time.sleep(2)

        return []


# ── DOCX manipulation ────────────────────────────────────────────────────────

def extract_images_from_docx(docx_path: str, work_dir: str) -> List[Tuple[str, str]]:
    """从 DOCX 提取图片到 work_dir/extracted/，返回 [(rId, local_path), ...]."""
    images: List[Tuple[str, str]] = []
    img_dir = Path(work_dir) / "extracted"
    img_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(docx_path, "r") as zf:
        # Read rels to get rId -> media path mapping
        rels_xml = zf.read("word/_rels/document.xml.rels")
        rels = _parse_rels(rels_xml)

        # Map media filename -> rId (rels targets are relative like "media/image1.png")
        media_to_rid: Dict[str, str] = {}
        for rid, target in rels.items():
            if target.startswith("media/"):
                media_to_rid[target] = rid

        for name in zf.namelist():
            if not name.startswith("word/media/"):
                continue
            ext = Path(name).suffix.lower()
            if ext not in SUPPORTED_IMAGE_EXTS:
                continue

            # rels target is "media/image1.png", zip name is "word/media/image1.png"
            rel_target = name[len("word/"):] if name.startswith("word/") else name
            rid = media_to_rid.get(rel_target)
            if rid is None:
                continue

            dest = img_dir / Path(name).name
            with zf.open(name) as src, open(dest, "wb") as dst:
                shutil.copyfileobj(src, dst)
            images.append((rid, str(dest)))

    return images


def _parse_rels(rels_xml: bytes) -> Dict[str, str]:
    """解析 .rels XML，返回 {rId: target_path}。"""
    root = ET.fromstring(rels_xml)
    mapping: Dict[str, str] = {}
    for rel in root:
        rid = rel.get("Id")
        target = rel.get("Target")
        if rid and target:
            mapping[rid] = target
    return mapping


def get_rid_to_images_mapping(docx_path: str) -> Dict[str, str]:
    """返回 {rId: media_filename} 映射。"""
    with zipfile.ZipFile(docx_path, "r") as zf:
        rels_xml = zf.read("word/_rels/document.xml.rels")
        rels = _parse_rels(rels_xml)
        return {rid: os.path.basename(target) for rid, target in rels.items()
                if target.startswith("media/")}


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _visible_text(element: ET.Element) -> str:
    pieces: List[str] = []
    for node in element.iter():
        if node.tag == f"{{{W}}}t" and node.text:
            pieces.append(node.text)
        elif node.tag == f"{{{W}}}tab":
            pieces.append("\t")
        elif node.tag == f"{{{W}}}br":
            pieces.append("\n")
    return "".join(pieces)


def _normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _field_instruction_text(element: ET.Element) -> str:
    pieces: List[str] = []
    for node in element.iter():
        if node.tag == f"{{{W}}}instrText" and node.text:
            pieces.append(node.text)
        elif node.tag == f"{{{W}}}fldSimple":
            instr = node.get(f"{{{W}}}instr")
            if instr:
                pieces.append(instr)
    return "".join(pieces)


def _block_style(paragraph: ET.Element) -> str:
    ppr = paragraph.find(f"{{{W}}}pPr")
    if ppr is None:
        return ""
    pstyle = ppr.find(f"{{{W}}}pStyle")
    if pstyle is None:
        return ""
    return pstyle.get(f"{{{W}}}val", "")


def _caption_style_sets(styles_xml: Optional[bytes]) -> Tuple[set[str], set[str], set[str]]:
    table_styles = set(TABLE_CAPTION_STYLE_IDS)
    generic_styles = set(GENERIC_CAPTION_STYLE_IDS)
    figure_styles = set(FIGURE_CAPTION_STYLE_IDS)
    if not styles_xml:
        return table_styles, generic_styles, figure_styles

    try:
        styles_root = ET.fromstring(styles_xml)
    except Exception:
        return table_styles, generic_styles, figure_styles

    for style in styles_root.iter(f"{{{W}}}style"):
        if style.get(f"{{{W}}}type") != "paragraph":
            continue
        style_id = style.get(f"{{{W}}}styleId", "")
        name_el = style.find(f"{{{W}}}name")
        style_name = name_el.get(f"{{{W}}}val", "") if name_el is not None else ""
        lower_name = style_name.lower()
        if not style_id:
            continue
        if "表注" in style_name or "table caption" in lower_name:
            table_styles.add(style_id)
        elif "图注" in style_name or "算法题注" in style_name or "figure caption" in lower_name:
            figure_styles.add(style_id)
        elif style_name in {"题注", "Caption"} or lower_name == "caption":
            generic_styles.add(style_id)
    return table_styles, generic_styles, figure_styles


def _strict_caption_kind(
    paragraph: ET.Element,
    table_styles: set[str],
    generic_styles: set[str],
    figure_styles: set[str],
) -> Optional[str]:
    instruction = _field_instruction_text(paragraph)
    if re.search(r"\bSEQ\s*表\b", instruction):
        return "表"
    if re.search(r"\bSEQ\s*图\b", instruction):
        return "图"
    if re.search(r"\bSEQ\s*算法\b", instruction):
        return "算法"
    if re.search(r"\bREF\s+", instruction):
        return None

    text = _visible_text(paragraph).lstrip()
    match = re.match(r"(算法|图|表)\s*\d+(?:[.\-]\d+)*", text)
    if match is None:
        return None
    kind = match.group(1)
    style_id = _block_style(paragraph)
    if kind == "表" and style_id in (table_styles | generic_styles):
        return "表"
    if kind in {"图", "算法"} and style_id in (figure_styles | generic_styles):
        return kind
    return None


def _plain_table_caption_text(paragraph: ET.Element) -> Optional[str]:
    instruction = _field_instruction_text(paragraph)
    if re.search(r"\bREF\s+", instruction) or re.search(r"\bSEQ\s*(?:图|算法)\b", instruction):
        return None
    text = _normalize_space(_visible_text(paragraph))
    if re.match(r"^表\s*\d+(?:[.\-]\d+)*(?:\s+|[：:])\S+", text):
        return text
    return None


def _image_rids_in_element(element: ET.Element) -> List[str]:
    rids: List[str] = []
    for blip in element.iter(f"{{{A}}}blip"):
        rid = blip.get(f"{{{R_NS}}}embed")
        if rid and rid not in rids:
            rids.append(rid)
    for image_data in element.iter(f"{{{V}}}imagedata"):
        rid = image_data.get(f"{{{R_NS}}}id")
        if rid and rid not in rids:
            rids.append(rid)
    return rids


def _is_empty_block(block: ET.Element) -> bool:
    if _image_rids_in_element(block):
        return False
    if block.tag == f"{{{W}}}p":
        return not _normalize_space(_visible_text(block))
    return _local_name(block.tag) == "sectPr"


def _is_ocr_image_block(block: ET.Element) -> bool:
    """True when a body block is an image-only object suitable for OCR replacement."""
    if not _image_rids_in_element(block):
        return False
    if block.tag == f"{{{W}}}p":
        return not _normalize_space(_visible_text(block))
    if block.tag == f"{{{W}}}tbl":
        return not _normalize_space(_visible_text(block))
    return False


def _next_meaningful_block_has_ocr_image(blocks: List[ET.Element], start_index: int) -> bool:
    for block in blocks[start_index:]:
        if _is_empty_block(block):
            continue
        return _is_ocr_image_block(block)
    return False


def extract_table_caption_image_contexts(docx_path: str) -> List[ImageCaptionContext]:
    """返回所有“表注下方图片”的上下文，正文图/表 REF 不会被视为题注。"""
    with zipfile.ZipFile(docx_path, "r") as zf:
        doc_xml = zf.read("word/document.xml")
        styles_xml = zf.read("word/styles.xml") if "word/styles.xml" in zf.namelist() else None

    if HAS_LXML:
        root = ET.fromstring(doc_xml)
    else:
        for prefix, uri in NSMAP.items():
            ET.register_namespace(prefix, uri)
        _register_all_namespaces(doc_xml)
        root = ET.fromstring(doc_xml)

    body = root.find(f"{{{W}}}body")
    if body is None:
        return []

    table_styles, generic_styles, figure_styles = _caption_style_sets(styles_xml)
    blocks = list(body)
    result: List[ImageCaptionContext] = []
    pending_caption: Optional[str] = None
    pending_index = -1
    image_index = 0

    def record_images(block: ET.Element, caption: str, caption_index: int, block_index: int) -> bool:
        nonlocal image_index
        if not _is_ocr_image_block(block):
            return False
        rids = _image_rids_in_element(block)
        if not rids:
            return False
        for rid in rids:
            image_index += 1
            result.append(ImageCaptionContext(
                rid=rid,
                caption_text=caption,
                image_index=image_index,
                caption_index=caption_index,
                block_index=block_index,
            ))
        return True

    for index, block in enumerate(blocks):
        if block.tag == f"{{{W}}}p":
            kind = _strict_caption_kind(block, table_styles, generic_styles, figure_styles)
            if kind == "表":
                caption = _normalize_space(_visible_text(block))
                if record_images(block, caption, index, index):
                    pending_caption = None
                    pending_index = -1
                else:
                    pending_caption = caption
                    pending_index = index
                continue
            if kind in {"图", "算法"}:
                pending_caption = None
                pending_index = -1
                continue

            plain_caption = _plain_table_caption_text(block)
            if plain_caption and _next_meaningful_block_has_ocr_image(blocks, index + 1):
                pending_caption = plain_caption
                pending_index = index
                continue

        if pending_caption:
            if record_images(block, pending_caption, pending_index, index):
                pending_caption = None
                pending_index = -1
                continue
            if _is_empty_block(block):
                continue
            pending_caption = None
            pending_index = -1

    return result


def extract_image_captions(docx_path: str) -> Dict[str, str]:
    """返回 {rId: caption_text}，只包含结构上位于表注下方的图片。"""
    captions: Dict[str, str] = {}
    for context in extract_table_caption_image_contexts(docx_path):
        captions.setdefault(context.rid, context.caption_text)
    return captions


def filter_table_candidates(images: List[Tuple[str, str]],
                            all_images: bool = False,
                            min_area: int = MIN_TABLE_AREA_EMU2,
                            docx_path: str = "",
                            captions: Optional[Dict[str, str]] = None,
                            table_captions_only: bool = False) -> List[Tuple[str, str]]:
    """根据图片尺寸和题注过滤候选表格图片。

    Args:
        table_captions_only: 为 True 时只处理结构化表注目标，不回退到尺寸启发式。
    """
    if all_images:
        return images

    # Prefer structural table-caption filtering whenever available. This avoids
    # treating body REF paragraphs such as "见表 1" as image captions.
    if captions:
        return [(rid, path) for rid, path in images if rid in captions]

    if table_captions_only:
        return []

    # Try to get EMU sizes from document.xml
    emu_sizes = _get_emu_sizes(docx_path) if docx_path else {}

    candidates: List[Tuple[str, str]] = []

    for rid, path in images:
        file_size = os.path.getsize(path)
        # If we have EMU data, use it
        if rid in emu_sizes:
            cx, cy = emu_sizes[rid]
            area = cx * cy
            if area >= min_area and cx >= MIN_TABLE_WIDTH_EMU and cy >= MIN_TABLE_HEIGHT_EMU:
                candidates.append((rid, path))
        else:
            # Fallback: assume images >50KB are potential tables
            # Formula/diagram images in this corpus are typically <50KB
            if file_size > 50 * 1024:
                candidates.append((rid, path))

    return candidates


def _get_emu_sizes(docx_path: str) -> Dict[str, Tuple[int, int]]:
    """从 document.xml 读取图片的 EMU 尺寸。"""
    sizes: Dict[str, Tuple[int, int]] = {}
    with zipfile.ZipFile(docx_path, "r") as zf:
        doc_xml = zf.read("word/document.xml")

    for prefix, uri in NSMAP.items():
        ET.register_namespace(prefix, uri)

    root = ET.fromstring(doc_xml)
    for drawing in root.iter(f"{{{W}}}drawing"):
        inline = drawing.find(f"{{{WP}}}inline")
        if inline is None:
            continue
        extent = inline.find(f"{{{WP}}}extent")
        if extent is None:
            continue
        cx = int(extent.get("cx", 0))
        cy = int(extent.get("cy", 0))
        if cx == 0 or cy == 0:
            continue
        blip = drawing.find(f".//{{{A}}}blip")
        if blip is None:
            continue
        embed = blip.get(f"{{{R_NS}}}embed")
        if embed:
            sizes[embed] = (cx, cy)

    return sizes


def _register_all_namespaces(xml_bytes: bytes) -> None:
    """从原始 XML 的根元素中提取并注册所有命名空间前缀。"""
    import re
    text = xml_bytes.decode("utf-8")
    # Find all xmlns:prefix="uri" declarations in the root element area (first 5000 chars)
    root_area = text[:5000] if len(text) > 5000 else text
    for m in re.finditer(r'xmlns:(\w+)="([^"]*)"', root_area):
        prefix, uri = m.groups()
        if prefix not in NSMAP:
            ET.register_namespace(prefix, uri)


def _extract_root_nsmap(xml_bytes: bytes) -> Dict[str, str]:
    """提取根元素上的 xmlns: 声明映射 {uri: prefix}。"""
    import re
    text = xml_bytes.decode("utf-8")
    result: Dict[str, str] = {}
    match = re.search(r'<\w+:\w+((?:\s+xmlns:\w+="[^"]*")+)', text)
    if match:
        for m in re.finditer(r'xmlns:(\w+)="([^"]*)"', match.group(0)):
            result[m.group(2)] = m.group(1)
    return result


def replace_images_with_tables(docx_path: str, replacements: Dict[Any, ET.Element],
                               output_path: str) -> int:
    """在 document.xml 中将指定 rId 的 w:drawing 替换为 OOXML 表格元素。

    Args:
        docx_path: 输入 DOCX 路径
        replacements: {rId: table_element} 或 {(rId, body_block_index): table_element} 映射
        output_path: 输出 DOCX 路径

    Returns:
        成功替换的数量
    """
    with zipfile.ZipFile(docx_path, "r") as zf:
        doc_xml_data = zf.read("word/document.xml")
        all_files = {name: zf.read(name) for name in zf.namelist()
                     if name != "word/document.xml"}

    # Parse document XML — lxml preserves namespaces automatically
    if HAS_LXML:
        root = ET.fromstring(doc_xml_data)
    else:
        for prefix, uri in NSMAP.items():
            ET.register_namespace(prefix, uri)
        _register_all_namespaces(doc_xml_data)
        root = ET.fromstring(doc_xml_data)
    body = root.find(f"{{{W}}}body")
    if body is None:
        print("Error: Cannot find w:body in document.xml", file=sys.stderr)
        return 0

    replaced_count = 0

    for block_index, block in enumerate(list(body)):
        target_key: Any = None
        for rid in _image_rids_in_element(block):
            occurrence_key = (rid, block_index)
            if occurrence_key in replacements:
                target_key = occurrence_key
                break
            if rid in replacements:
                target_key = rid
                break
        if target_key is None:
            continue
        table_elem = copy.deepcopy(replacements[target_key])
        body_index = list(body).index(block)
        body.insert(body_index, table_elem)
        body.remove(block)
        replaced_count += 1

    # Write modified DOCX
    if replaced_count > 0:
        if HAS_LXML:
            xml_bytes = ET.tostring(root, encoding="UTF-8", xml_declaration=True,
                                    pretty_print=False, standalone="yes")
            xml_str = xml_bytes.decode("utf-8")
        else:
            xml_str = ET.tostring(root, encoding="unicode", xml_declaration=True)
            if not xml_str.startswith("<?xml"):
                xml_str = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml_str

        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf_out:
            zf_out.writestr("word/document.xml", xml_str.encode("utf-8"))
            for name, data in all_files.items():
                zf_out.writestr(name, data)
    else:
        shutil.copy2(docx_path, output_path)

    return replaced_count


# ── main processing ──────────────────────────────────────────────────────────

def process_docx(docx_path: str, client: OCRClient, *,
                 output_path: str = "",
                 min_area: int = MIN_TABLE_AREA_EMU2,
                 all_images: bool = False,
                 table_captions_only: bool = False,
                 dry_run: bool = False,
                 ) -> Tuple[int, int, int]:
    """处理单个 DOCX 文件。

    Returns:
        (candidate_count, table_count, replaced_count)
    """
    print(f"\nProcessing: {docx_path}")

    with tempfile.TemporaryDirectory(prefix="docx-convert-") as tmpdir:
        # 1. Extract images
        images = extract_images_from_docx(docx_path, tmpdir)
        print(f"  Found {len(images)} images in word/media/")

        if not images:
            return 0, 0, 0

        # 1.5 Extract structural table-caption image targets for display and filtering
        caption_contexts = extract_table_caption_image_contexts(docx_path)
        image_paths = dict(images)
        usable_contexts = [context for context in caption_contexts if context.rid in image_paths]
        missing_contexts = [context for context in caption_contexts if context.rid not in image_paths]
        print(f"  Table-caption image blocks found: {len(caption_contexts)}")
        if missing_contexts:
            print(f"  Warning: {len(missing_contexts)} table-caption image block(s) are unsupported media")

        # 2. Filter table candidates
        if all_images:
            candidates = [(rid, path, None) for rid, path in images]
        elif usable_contexts:
            candidates = [(context.rid, image_paths[context.rid], context) for context in usable_contexts]
        elif table_captions_only:
            candidates = []
        else:
            captions = extract_image_captions(docx_path)
            candidates = [
                (rid, path, None)
                for rid, path in filter_table_candidates(images, all_images, min_area, docx_path, captions=captions)
            ]
        mode = (
            "all images"
            if all_images
            else "table-caption image blocks"
            if usable_contexts or table_captions_only
            else "size fallback"
        )
        print(f"  Candidates for OCR ({mode}): {len(candidates)}")

        if not candidates:
            print("  No table candidates found. Use --all-images to process all embedded images.")
            return len(images), 0, 0

        # 3. Process each candidate with OCR
        replacements: Dict[Any, ET.Element] = {}
        ocr_cache: Dict[str, List[Dict[str, Any]]] = {}
        table_count = 0
        processed = 0

        for rid, img_path, context in candidates:
            processed += 1
            caption_text = context.caption_text if context is not None else None
            image_name = Path(img_path).name
            print(f"  [{processed}/{len(candidates)}] OCR image={image_name} rId={rid}", flush=True)
            if caption_text:
                print(f"      caption: {caption_text}", flush=True)

            try:
                cached = rid in ocr_cache
                if cached:
                    blocks = ocr_cache[rid]
                elif client.use_pipeline_direct:
                    blocks = client.process_image(img_path)
                else:
                    blocks = client.process_image_via_backend(img_path)
                if not cached:
                    ocr_cache[rid] = blocks
            except Exception as exc:
                print(f"      result: FAILED: {exc}")
                continue

            # Extract table blocks
            table_blocks = [b for b in blocks if b.get("label", "").lower() == "table"
                          and b.get("content")]
            if not table_blocks:
                labels = sorted({str(b.get("label", "")) for b in blocks if b.get("label")})
                label_text = ", ".join(labels) if labels else "none"
                print(f"      result: no table content found (layout labels: {label_text})")
                continue

            # Convert HTML tables to OOXML
            all_tables: List[ET.Element] = []
            table_summaries: List[str] = []
            for block in table_blocks:
                html_content = block.get("content", "")
                if not html_content:
                    continue
                parsed = parse_html_tables(html_content)
                for tbl in parsed:
                    table_summaries.append(summarize_table_grid(tbl))
                    all_tables.append(build_ooxml_table(tbl))

            if not all_tables:
                print(f"      result: no HTML tables parsed (table blocks: {len(table_blocks)})")
                continue

            # Store the first (primary) table for this image
            replacement_key: Any = (rid, context.block_index) if context is not None else rid
            replacements[replacement_key] = all_tables[0]
            table_count += 1
            primary_summary = table_summaries[0] if table_summaries else "unknown shape"
            print(
                f"      result: OK; layout_table_blocks={len(table_blocks)}; "
                f"parsed_tables={len(all_tables)}; primary={primary_summary}"
                + ("; cached_ocr=true" if cached else "")
            )

        print(f"  Tables extracted: {table_count}/{processed}")

        if dry_run:
            print("  [DRY RUN] Would replace images with tables:")
            candidate_by_key = {
                ((rid, context.block_index) if context is not None else rid): (rid, img_path, context)
                for rid, img_path, context in candidates
            }
            for key in replacements:
                rid, img_path, context = candidate_by_key.get(key, ("", "", None))
                caption_text = context.caption_text if context is not None else ""
                label = caption_text if caption_text else str(key)
                image_name = Path(img_path).name if img_path else ""
                print(f"    {label} | image={image_name} rId={rid} -> table")
            return len(candidates), table_count, len(replacements)

        # 4. Replace images with tables in DOCX
        if replacements:
            out = output_path or _default_output_path(docx_path)
            replaced = replace_images_with_tables(docx_path, replacements, out)
            print(f"  Replaced {replaced} images -> Saved: {out}")
            return len(candidates), table_count, replaced
        else:
            print("  No tables to replace.")
            return len(candidates), 0, 0


def _default_output_path(input_path: str) -> str:
    p = Path(input_path)
    return str(p.parent / f"{p.stem}_converted{p.suffix}")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Batch convert image tables in DOCX to Word native tables",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  %(prog)s input.docx                 Basic conversion
  %(prog)s input.docx -o output.docx  Specify output path
  %(prog)s --all-images input.docx    Process all images (skip size filter)
  %(prog)s --dry-run input.docx       Analyze without modifying
  %(prog)s --pipeline-url http://10.0.0.1:5002/glmocr/parse input.docx
  %(prog)s --backend-url http://10.0.0.1:8000 input.docx
""",
    )
    parser.add_argument("input", help="Input DOCX file or directory")
    parser.add_argument("-o", "--output", help="Output DOCX path (default: input_converted.docx)")
    parser.add_argument("--all-images", action="store_true",
                        help="Process all images (skip size and caption filtering)")
    parser.add_argument("--table-captions-only", action="store_true",
                        help="Require structural 表 caption targets; do not fall back to size filtering")
    parser.add_argument("--dry-run", action="store_true",
                        help="Analyze and show what would be replaced without modifying")
    parser.add_argument("--pipeline-url", default="http://localhost:5002/glmocr/parse",
                        help="Pipeline service URL (use for fast synchronous OCR)")
    parser.add_argument("--backend-url", default="http://localhost:8000",
                        help="Backend API URL (for task-based OCR)")
    parser.add_argument("--use-backend", action="store_true",
                        help="Use backend task API instead of pipeline direct")
    parser.add_argument("--timeout", type=int, default=300,
                        help="OCR request timeout in seconds (default: 300)")
    parser.add_argument("--insecure", action="store_true",
                        help="Disable SSL verification")
    parser.add_argument("--min-area-emu2", type=int, default=MIN_TABLE_AREA_EMU2,
                        help="Minimum image area (EMU²) for table detection")

    args = parser.parse_args()

    client = OCRClient(
        backend_url=args.backend_url,
        pipeline_url=args.pipeline_url,
        use_pipeline_direct=not args.use_backend,
        insecure=args.insecure,
        timeout=args.timeout,
    )

    input_path = args.input
    if os.path.isdir(input_path):
        docx_files = sorted(Path(input_path).glob("*.docx"))
        if not docx_files:
            print("No .docx files found in directory.", file=sys.stderr)
            sys.exit(1)
    else:
        docx_files = [Path(input_path)]
        if not docx_files[0].exists():
            print(f"File not found: {input_path}", file=sys.stderr)
            sys.exit(1)

    total_imgs = 0
    total_tables = 0
    total_replaced = 0
    failed = 0

    for docx_file in docx_files:
        output = args.output if args.output and len(docx_files) == 1 else ""
        try:
            ni, nt, nr = process_docx(
                str(docx_file), client,
                output_path=output,
                min_area=args.min_area_emu2,
                all_images=args.all_images,
                table_captions_only=args.table_captions_only,
                dry_run=args.dry_run,
            )
            total_imgs += ni
            total_tables += nt
            total_replaced += nr
            if nt == 0 and ni > 0:
                failed += 1
        except Exception as exc:
            print(f"Error processing {docx_file}: {exc}", file=sys.stderr)
            failed += 1

    print(f"\n{'='*60}")
    print(f"Summary: {len(docx_files)} file(s), {total_imgs} images, "
          f"{total_tables} tables, {total_replaced} replaced"
          + (f", {failed} failed" if failed else ""))


if __name__ == "__main__":
    main()
