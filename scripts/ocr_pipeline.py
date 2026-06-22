#!/usr/bin/env python3
"""
Batch OCR pipeline: CSV → file scan → text-PDF / OCR-API routing → SQLite store.

Workflow
--------
1. Read a CSV whose ``file_path`` column points at one or more directories.
2. Recursively scan each directory for supported files
   (``.pdf .jpg .jpeg .png .tiff .tif .bmp .webp``).
3. For every file:
   - If it is a *text* PDF (PyMuPDF extracts > 100 chars from the first 3
     pages) → extract text page-by-page with the system ``pdftotext`` tool.
   - Otherwise → submit to the local GLM-OCR backend
     (``POST /api/v1/tasks/upload`` then poll ``GET /api/v1/tasks/{task_id}``)
     with exponential-backoff retries.
4. Persist one ``ocr_results`` row per page (image files are always page 1)
   and track progress in ``ocr_jobs`` for crash-safe resume.

The OCR backend speaks the GLM-OCR task API (see ``AGENTS.md``): multipart
upload returns a ``task_id``, polling returns ``full_markdown`` plus a
``layout`` array whose blocks carry a 1-based ``page_index``.  The anonymous
owner-cookie (``ocr_owner_token``) issued on first upload is stored and resent
automatically by :class:`requests.Session`, so no API key / JWT is required.

Resume semantics
----------------
All discovered files are ``INSERT OR IGNORE``-ed into ``ocr_jobs`` with
``status='pending'`` at startup.  Each run picks up
``status IN ('pending','failed') AND retry_count < max_retries`` rows, flips
them to ``'processing'`` (atomic claim), then to ``'done'`` or ``'failed'``.
Re-running the script therefore continues where it stopped.

Dependencies: PyMuPDF, tqdm, requests, python-dotenv  (see scripts/requirements.txt).
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional

# ─── optional dependency loaders (mirror scripts/batch_pdf_ocr.py style) ──────

def require_fitz():
    """Import PyMuPDF or exit with a helpful message."""
    try:
        import fitz  # type: ignore
        return fitz
    except ModuleNotFoundError as exc:  # pragma: no cover - environment guard
        raise SystemExit("缺少依赖 PyMuPDF，请先安装: pip install PyMuPDF") from exc


def require_tqdm():
    """Import tqdm or exit with a helpful message."""
    try:
        from tqdm import tqdm  # type: ignore
        return tqdm
    except ModuleNotFoundError as exc:  # pragma: no cover - environment guard
        raise SystemExit("缺少依赖 tqdm，请先安装: pip install tqdm") from exc


def require_requests():
    """Import requests or exit with a helpful message."""
    try:
        import requests  # type: ignore
        return requests
    except ModuleNotFoundError as exc:  # pragma: no cover - environment guard
        raise SystemExit("缺少依赖 requests，请先安装: pip install requests") from exc


def load_dotenv_if_present(path: Path) -> None:
    """Populate ``os.environ`` from a .env file when python-dotenv is available.

    We prefer python-dotenv but fall back to a tiny hand-rolled parser so the
    script still runs without the extra dependency.
    """
    if not path.exists():
        return

    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(dotenv_path=str(path), override=False)
        return
    except ModuleNotFoundError:
        pass

    # Minimal fallback parser: KEY=VALUE per line, ``#`` comments, ``export `` prefix.
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, _sep, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


# ─── constants ────────────────────────────────────────────────────────────────

SUPPORTED_EXTS: frozenset[str] = frozenset({
    ".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp",
})

DEFAULT_DB_PATH = Path("./ocr_results.db").resolve()
DEFAULT_LOG_DIR = Path("./logs").resolve()
DEFAULT_LOG_FILE = DEFAULT_LOG_DIR / "ocr_pipeline.log"

DEFAULT_OCR_API = "http://localhost:8000"
DEFAULT_PROCESSING_MODE = "pipeline"
DEFAULT_OUTPUT_FORMAT = "markdown"
DEFAULT_PRIORITY = 2

# Text-PDF heuristic thresholds (see is_text_pdf docstring).
TEXT_PDF_PROBE_PAGES = 3
TEXT_PDF_MIN_CHARS = 100

# Owner-cookie issued by the GLM-OCR backend (settings.OWNER_COOKIE_NAME).
OWNER_COOKIE_NAME = "ocr_owner_token"

LOG = logging.getLogger("ocr_pipeline")


# ─── data structures ──────────────────────────────────────────────────────────

@dataclass(frozen=True)
class OcrJob:
    """A single unit of work tracked in the ``ocr_jobs`` table."""

    id: int
    csv_row_id: str
    file_path: str
    status: str
    process_type: str
    retry_count: int
    task_id: str = ""


@dataclass
class PageResult:
    """One page worth of recognised text to be stored in ``ocr_results``."""

    page_number: int
    content: str


# ─── logging ──────────────────────────────────────────────────────────────────

def setup_logging(log_file: Path, level: str = "INFO") -> None:
    """Configure root logging to stderr and a rotating-style file handler.

    Includes timestamp, level, thread name and logger name so concurrent
    workers stay distinguishable in the log file.
    """
    log_file.parent.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    # Remove handlers from a previous invocation (e.g. tests calling main twice).
    for handler in list(root.handlers):
        root.removeHandler(handler)

    fmt = logging.Formatter(
        fmt="%(asctime)s [%(threadName)s] %(levelname)s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    stream = logging.StreamHandler()
    stream.setFormatter(fmt)
    root.addHandler(stream)

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(fmt)
    root.addHandler(file_handler)


# ─── database ─────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS ocr_jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    csv_row_id   TEXT        NOT NULL,
    file_path    TEXT        NOT NULL UNIQUE,
    status       TEXT        NOT NULL DEFAULT 'pending',
    process_type TEXT,
    retry_count  INTEGER     NOT NULL DEFAULT 0,
    error_msg    TEXT,
    task_id      TEXT,
    created_at   DATETIME    NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at   DATETIME    NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS ocr_results (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id         INTEGER NOT NULL
                   REFERENCES ocr_jobs(id) ON DELETE CASCADE,
    file_path      TEXT    NOT NULL,
    page_number    INTEGER NOT NULL,
    content        TEXT,
    source_csv_row TEXT,
    created_at     DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status       ON ocr_jobs (status);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_resume
    ON ocr_jobs (status, retry_count);
CREATE INDEX IF NOT EXISTS idx_ocr_results_job_id    ON ocr_results (job_id);
CREATE INDEX IF NOT EXISTS idx_ocr_results_file_path ON ocr_results (file_path);
"""


def open_database(db_path: Path) -> sqlite3.Connection:
    """Open a SQLite connection tuned for concurrent access.

    Enables WAL mode (concurrent readers + one writer) and a busy timeout so
    transient ``database is locked`` errors retry instead of raising.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        str(db_path),
        timeout=30.0,            # retry on SQLITE_BUSY for up to 30s
        isolation_level=None,    # autocommit; we manage transactions explicitly
        check_same_thread=False, # connections are per-thread (see JobStore)
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Create tables / indices if they do not yet exist."""
    with conn:  # single transaction
        conn.executescript(SCHEMA_SQL)


class JobStore:
    """Thread-safe façade over per-thread SQLite connections.

    Each worker thread gets its own connection via :func:`threading.local`,
    which keeps SQLite happy (a single connection cannot be shared across
    threads by default).  WAL mode lets writers from different threads
    coordinate through the busy-timeout retry.
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._tls = threading.local()
        # Initialise schema on the main-thread connection right away.
        with self._cursor() as cur:
            cur.connection.executescript(SCHEMA_SQL)
            self._migrate(cur.connection)

    @staticmethod
    def _migrate(conn: sqlite3.Connection) -> None:
        """Add columns missing from older schemas (safe to re-run)."""
        cols = {row[1] for row in conn.execute("PRAGMA table_info(ocr_jobs)")}
        if "task_id" not in cols:
            conn.execute("ALTER TABLE ocr_jobs ADD COLUMN task_id TEXT")

    @contextmanager
    def _cursor(self) -> Iterator[sqlite3.Cursor]:
        conn = getattr(self._tls, "conn", None)
        if conn is None:
            conn = open_database(self._db_path)
            self._tls.conn = conn
        yield conn.cursor()

    # ── discovery / seeding ───────────────────────────────────────────────────

    def seed_jobs(self, entries: Iterable[tuple[str, str]]) -> int:
        """Insert (csv_row_id, file_path) pairs, ignoring duplicates.

        Returns the number of rows actually inserted (newly discovered files).
        Existing rows are untouched so prior progress is preserved.
        """
        inserted = 0
        rows = list(entries)
        if not rows:
            return 0
        with self._cursor() as cur:
            cur.executemany(
                "INSERT OR IGNORE INTO ocr_jobs (csv_row_id, file_path, status) "
                "VALUES (?, ?, 'pending')",
                rows,
            )
            inserted = cur.rowcount if cur.rowcount != -1 else 0
        LOG.info("Seeded %d new job(s) (%d total unique paths)",
                 inserted, len(rows))
        return inserted

    def reset_orphans(self) -> int:
        """Reset ``processing`` jobs left by a crashed run back to ``pending``."""
        with self._cursor() as cur:
            cur.execute(
                "UPDATE ocr_jobs SET status='pending', updated_at=CURRENT_TIMESTAMP "
                "WHERE status='processing'"
            )
            count = cur.rowcount if cur.rowcount != -1 else 0
        if count:
            LOG.info("已重置 %d 个孤儿 job (processing → pending)", count)
        return count

    def save_task_id(self, job_id: int, task_id: str) -> None:
        """Persist the backend task_id so polling can resume after a crash."""
        with self._cursor() as cur:
            cur.execute(
                "UPDATE ocr_jobs SET task_id=?, updated_at=CURRENT_TIMESTAMP "
                "WHERE id=?",
                (task_id, job_id),
            )

    # ── claim / fetch ─────────────────────────────────────────────────────────

    def fetch_pending(self, max_retries: int, limit: int = 0) -> list[OcrJob]:
        """Return jobs eligible for processing this run.

        Eligible = ``status IN ('pending','failed')`` and the file-level
        retry budget is not exhausted (``retry_count < max_retries``).
        """
        sql = (
            "SELECT id, csv_row_id, file_path, status, "
            "       COALESCE(process_type, '') AS process_type, retry_count, "
            "       COALESCE(task_id, '') AS task_id "
            "FROM ocr_jobs "
            "WHERE status IN ('pending', 'failed') "
            "  AND retry_count < ? "
            "ORDER BY id"
        )
        params: list[Any] = [max_retries]
        if limit and limit > 0:
            sql += " LIMIT ?"
            params.append(limit)
        with self._cursor() as cur:
            cur.execute(sql, params)
            return [OcrJob(**row) for row in cur.fetchall()]

    def claim(self, job_id: int, process_type: str) -> bool:
        """Atomically flip a job to ``processing``.

        The ``WHERE status IN (...)`` guard makes the claim safe even if two
        threads somehow targeted the same row.
        """
        with self._cursor() as cur:
            cur.execute(
                "UPDATE ocr_jobs "
                "SET status='processing', process_type=?, updated_at=CURRENT_TIMESTAMP "
                "WHERE id=? AND status IN ('pending', 'failed')",
                (process_type, job_id),
            )
            return cur.rowcount == 1

    # ── completion ────────────────────────────────────────────────────────────

    def mark_done(self, job_id: int, results: list[PageResult]) -> None:
        """Persist page results and mark the job ``done`` in one transaction."""
        with self._cursor() as cur:
            conn = cur.connection
            conn.execute("BEGIN")
            try:
                cur.execute(
                    "SELECT csv_row_id, file_path FROM ocr_jobs WHERE id=?",
                    (job_id,),
                )
                row = cur.fetchone()
                csv_row_id = row["csv_row_id"] if row else ""
                file_path = row["file_path"] if row else ""

                if results:
                    cur.executemany(
                        "INSERT INTO ocr_results "
                        "(job_id, file_path, page_number, content, source_csv_row) "
                        "VALUES (?, ?, ?, ?, ?)",
                        [
                            (job_id, file_path, r.page_number, r.content, csv_row_id)
                            for r in results
                        ],
                    )
                cur.execute(
                    "UPDATE ocr_jobs "
                    "SET status='done', error_msg=NULL, updated_at=CURRENT_TIMESTAMP "
                    "WHERE id=?",
                    (job_id,),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def mark_failed(self, job_id: int, error_msg: str) -> None:
        """Record a failure and bump the per-file retry counter."""
        truncated = (error_msg or "")[:2000]
        with self._cursor() as cur:
            conn = cur.connection
            conn.execute("BEGIN")
            try:
                cur.execute(
                    "UPDATE ocr_jobs "
                    "SET status='failed', retry_count=retry_count+1, "
                    "    error_msg=?, updated_at=CURRENT_TIMESTAMP "
                    "WHERE id=?",
                    (truncated, job_id),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def stats(self) -> dict[str, int]:
        """Return a {status: count} summary for the final report."""
        with self._cursor() as cur:
            cur.execute(
                "SELECT status, COUNT(*) AS n FROM ocr_jobs GROUP BY status"
            )
            return {row["status"]: row["n"] for row in cur.fetchall()}

    def close_thread(self) -> None:
        """Close the calling thread's connection (called from worker exit)."""
        conn = getattr(self._tls, "conn", None)
        if conn is not None:
            conn.close()
            self._tls.conn = None


# ─── CSV + file discovery ─────────────────────────────────────────────────────

def _pick_path_column(fieldnames: list[str]) -> str:
    """Choose the column holding the directory/file path."""
    for candidate in ("file_path", "filepath", "path", "dir", "directory"):
        if candidate in fieldnames:
            return candidate
    raise SystemExit(
        "CSV 缺少 file_path 列。请确保 CSV 包含 file_path 列指向待扫描的目录。"
    )


def _pick_id_column(fieldnames: list[str]) -> Optional[str]:
    """Choose an optional identifier column (id / row id)."""
    for candidate in ("id", "csv_row_id", "row_id", "uid"):
        if candidate in fieldnames:
            return candidate
    return None


def _iter_csv_rows(csv_path: Path) -> Iterator[dict[str, str]]:
    """Yield CSV rows as dicts, tolerating BOM and CRLF."""
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def discover_files(csv_path: Path) -> list[tuple[str, str]]:
    """Expand the CSV into ``(csv_row_id, absolute_file_path)`` pairs.

    Each row's ``file_path`` may be either a directory (recursively scanned
    for supported extensions) or a single supported file.  ``csv_row_id``
    comes from an ``id``-like column when present, otherwise the 1-based CSV
    line number.
    """
    rows_iter = _iter_csv_rows(csv_path)
    first = next(rows_iter, None)
    if first is None:
        raise SystemExit(f"CSV 文件为空或没有数据行: {csv_path}")

    fieldnames = list(first.keys())
    path_col = _pick_path_column(fieldnames)
    id_col = _pick_id_column(fieldnames)

    entries: list[tuple[str, str]] = []
    seen: set[str] = set()

    def _add(row_id: str, abs_path: str) -> None:
        if abs_path in seen:
            return
        seen.add(abs_path)
        entries.append((row_id, abs_path))

    line_no = 1  # header is line 1; first data row is line 2
    for row in [first, *rows_iter]:
        line_no += 1
        row_id = (row.get(id_col) or "").strip() or f"line-{line_no}"
        raw = (row.get(path_col) or "").strip()
        if not raw:
            LOG.warning("CSV 第 %d 行 %s 为空，跳过", line_no, path_col)
            continue

        target = Path(raw).expanduser()
        if not target.exists():
            LOG.warning("CSV 第 %d 行路径不存在: %s", line_no, raw)
            continue

        if target.is_file():
            if target.suffix.lower() in SUPPORTED_EXTS:
                _add(row_id, str(target.resolve()))
            else:
                LOG.warning("CSV 第 %d 行文件扩展名不支持: %s", line_no, raw)
            continue

        # directory → recursive walk
        for root, _dirs, files in os.walk(target):
            for name in sorted(files):
                if Path(name).suffix.lower() in SUPPORTED_EXTS:
                    _add(row_id, str(Path(root, name).resolve()))

    return entries


# ─── text-PDF detection & extraction ──────────────────────────────────────────

def is_text_pdf(path: str, probe_pages: int = TEXT_PDF_PROBE_PAGES) -> bool:
    """Return True when *path* looks like a text-layer PDF.

    Opens the PDF with PyMuPDF and counts extracted characters across the
    first ``probe_pages`` pages; if that total exceeds
    :data:`TEXT_PDF_MIN_CHARS` we treat it as a born-digital text PDF and
    skip OCR.  Any error reading the PDF is treated as "not a text PDF" so
    the file is routed to the OCR API instead.
    """
    fitz = require_fitz()
    try:
        with fitz.open(path) as doc:  # type: ignore[attr-defined]
            total = 0
            for i in range(min(probe_pages, doc.page_count)):
                total += len(doc[i].get_text("text"))
            return total > TEXT_PDF_MIN_CHARS
    except Exception as exc:
        LOG.warning("is_text_pdf 读取失败 (%s): %s — 按非文本 PDF 处理", path, exc)
        return False


def _pdf_page_count(path: str) -> int:
    """Return the number of pages in *path* (best-effort)."""
    fitz = require_fitz()
    try:
        with fitz.open(path) as doc:  # type: ignore[attr-defined]
            return int(doc.page_count)
    except Exception:
        return 0


def process_text_pdf(path: str) -> list[PageResult]:
    """Extract text from a text PDF page-by-page via the ``pdftotext`` tool.

    Uses ``pdftotext -layout -f N -l N <file> -`` so each page becomes one
    :class:`PageResult`.  Empty pages are still recorded (with empty
    content) to preserve page-number alignment.
    """
    page_count = _pdf_page_count(path) or 1
    results: list[PageResult] = []
    for page in range(1, page_count + 1):
        cmd = [
            "pdftotext", "-layout",
            "-f", str(page),
            "-l", str(page),
            path, "-",  # '-' → write to stdout
        ]
        try:
            proc = subprocess.run(  # noqa: S603 - controlled argv
                cmd,
                check=True,
                capture_output=True,
                text=True,
                timeout=120,
            )
            content = proc.stdout or ""
        except FileNotFoundError:
            raise RuntimeError("系统未安装 pdftotext（poppler-utils）")
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(
                f"pdftotext 第 {page} 页失败: "
                f"{(exc.stderr or '').strip() or exc}"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"pdftotext 第 {page} 页超时") from exc

        results.append(PageResult(page_number=page, content=content.rstrip()))
    return results


# ─── OCR backend client ───────────────────────────────────────────────────────

class OCRApiClient:
    """Thin synchronous client for the GLM-OCR backend task API.

    Endpoint summary (all under ``/api/v1``):

    ===========  ===================================  ==========================
    Method       Path                                Body / return
    ===========  ===================================  ==========================
    ``POST``     ``/tasks/upload``                   multipart (file,
                                                    processing_mode, priority,
                                                    output_format) →
                                                    ``{data:{task_id}}``
    ``GET``      ``/tasks/{task_id}``                → ``{data:{status,
                                                    full_markdown, layout}}``
    ``GET``      ``/system/health``                  → ``{workers_count}``
    ===========  ===================================  ==========================

    The backend issues an ``ocr_owner_token`` cookie on first upload that
    scopes task ownership; :class:`requests.Session` persists and re-sends
    it automatically, so no explicit auth is needed.
    """

    TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled", "dead_letter"})

    def __init__(
        self,
        base_url: str,
        *,
        processing_mode: str = DEFAULT_PROCESSING_MODE,
        output_format: str = DEFAULT_OUTPUT_FORMAT,
        priority: int = DEFAULT_PRIORITY,
        poll_interval: float = 2.0,
        request_timeout: float = 300.0,
        max_retries: int = 3,
        max_wait_seconds: int = 0,
        cookie_file: Optional[Path] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.processing_mode = processing_mode
        self.output_format = output_format
        self.priority = priority
        self.poll_interval = poll_interval
        self.request_timeout = request_timeout
        self.max_retries = max(1, max_retries)
        self.max_wait_seconds = max_wait_seconds
        self._cookie_file = cookie_file
        self._session = require_requests().Session()
        self._load_cookie()

    # ── transport with exponential backoff ────────────────────────────────────

    def _request(self, method: str, url: str, **kwargs: Any) -> Any:
        """Issue an HTTP request with exponential-backoff retries.

        Retries on connection errors and 5xx responses; 4xx responses raise
        immediately (they won't fix themselves).  Backoff is ``2**attempt``
        seconds, capped at 60s.
        """
        requests = require_requests()
        last_exc: Optional[BaseException] = None
        for attempt in range(self.max_retries):
            try:
                resp = self._session.request(
                    method, url, timeout=self.request_timeout, **kwargs
                )
            except requests.RequestException as exc:
                last_exc = exc
                LOG.warning("HTTP %s %s 网络错误 (attempt %d/%d): %s",
                            method, url, attempt + 1, self.max_retries, exc)
            else:
                if 200 <= resp.status_code < 300:
                    return resp
                if 400 <= resp.status_code < 500:
                    resp.raise_for_status()
                last_exc = RuntimeError(
                    f"HTTP {resp.status_code}: {resp.text[:300]}"
                )
                LOG.warning("HTTP %s %s 返回 %d (attempt %d/%d)",
                            method, url, resp.status_code,
                            attempt + 1, self.max_retries)

            if attempt < self.max_retries - 1:
                delay = min(60.0, float(2 ** attempt))
                LOG.info("退避 %.1fs 后重试...", delay)
                time.sleep(delay)

        raise RuntimeError(
            f"请求 {method} {url} 在 {self.max_retries} 次重试后仍失败"
        ) from last_exc

    # ── cookie persistence ────────────────────────────────────────────────────

    def _load_cookie(self) -> None:
        if self._cookie_file and self._cookie_file.exists():
            token = self._cookie_file.read_text(encoding="utf-8").strip()
            if token:
                self._session.cookies.set(OWNER_COOKIE_NAME, token)
                LOG.debug("从 %s 加载 owner cookie", self._cookie_file)

    def _save_cookie(self) -> None:
        if not self._cookie_file:
            return
        token = self._session.cookies.get(OWNER_COOKIE_NAME)
        if token:
            self._cookie_file.parent.mkdir(parents=True, exist_ok=True)
            self._cookie_file.write_text(token, encoding="utf-8")
            LOG.debug("保存 owner cookie 到 %s", self._cookie_file)

    # ── task lifecycle ─────────────────────────────────────────────────────────

    def upload(self, file_path: str) -> str:
        """Submit *file_path* and return the new ``task_id``."""
        path = Path(file_path)
        with path.open("rb") as handle:
            resp = self._request(
                "POST",
                f"{self.base_url}/api/v1/tasks/upload",
                files={"file": (path.name, handle)},
                data={
                    "processing_mode": self.processing_mode,
                    "priority": str(self.priority),
                    "output_format": self.output_format,
                },
            )
        payload = resp.json()
        if not payload.get("success"):
            raise RuntimeError(payload.get("message") or "提交任务失败")
        task_id = (payload.get("data") or {}).get("task_id")
        if not task_id:
            raise RuntimeError(f"上传响应缺少 task_id: {payload}")
        self._save_cookie()
        return str(task_id)

    def poll(self, task_id: str) -> dict[str, Any]:
        """Block until the task reaches a terminal status; return its ``data``."""
        start = time.monotonic()
        last_log = 0.0
        while True:
            resp = self._request("GET", f"{self.base_url}/api/v1/tasks/{task_id}")
            payload = resp.json()
            if not payload.get("success"):
                raise RuntimeError(payload.get("message") or "查询任务状态失败")
            data = payload.get("data") or {}
            status = str(data.get("status", "")).lower()

            if status in self.TERMINAL_STATUSES:
                elapsed = time.monotonic() - start
                if status == "completed":
                    LOG.info("任务 %s 完成 (耗时 %.0fs)", task_id, elapsed)
                    return data
                raise RuntimeError(
                    f"任务 {task_id} 终态为 {status} (耗时 {elapsed:.0f}s): "
                    f"{data.get('error_message') or ''}"
                )

            if self.max_wait_seconds > 0 and \
                    (time.monotonic() - start) > self.max_wait_seconds:
                raise TimeoutError(
                    f"任务 {task_id} 超过最大等待 {self.max_wait_seconds}s"
                )

            now = time.monotonic()
            if now - last_log >= 30.0:
                progress = data.get("progress")
                step = data.get("current_step") or data.get("current_stage")
                elapsed = now - start
                LOG.info("轮询 %s: status=%s progress=%s step=%s 已等待 %.0fs",
                         task_id, status, progress, step, elapsed)
                last_log = now

            time.sleep(self.poll_interval)

    # ── high-level helper ──────────────────────────────────────────────────────

    def process_file(self, file_path: str) -> list[PageResult]:
        """Upload *file_path*, wait for completion, split results per page."""
        task_id = self.upload(file_path)
        LOG.info("已提交 %s → task_id=%s", Path(file_path).name, task_id)
        data = self.poll(task_id)
        return self._split_into_pages(data, file_path)

    @staticmethod
    def _split_into_pages(data: dict[str, Any], file_path: str) -> list[PageResult]:
        """Turn a completed-task payload into per-page :class:`PageResult`.

        Layout blocks carry a 1-based ``page_index``; we group their
        ``block_content`` by page.  If no layout blocks are present we fall
        back to ``full_markdown`` as page 1 (this also covers single-image
        inputs, which are always page 1).
        """
        layout = data.get("layout")
        results: list[PageResult] = []

        if isinstance(layout, list) and layout:
            pages: dict[int, list[str]] = {}
            for block in layout:
                if not isinstance(block, dict):
                    continue
                page_index = block.get("page_index")
                if isinstance(page_index, str) and page_index.isdigit():
                    page_index = int(page_index)
                if not isinstance(page_index, int) or page_index < 1:
                    page_index = 1
                content = block.get("block_content")
                if content is None:
                    content = block.get("content")
                if isinstance(content, str) and content.strip():
                    pages.setdefault(page_index, []).append(content)
            for page_number in sorted(pages):
                results.append(
                    PageResult(page_number, "\n\n".join(pages[page_number]).strip())
                )

        if not results:
            markdown = (data.get("full_markdown") or "").strip()
            if markdown:
                results.append(PageResult(1, markdown))
            else:
                LOG.warning("%s OCR 返回空内容 (无 layout / full_markdown)", file_path)
                results.append(PageResult(1, ""))
        return results


# ─── worker ───────────────────────────────────────────────────────────────────

def process_one(
    job: OcrJob,
    store: JobStore,
    client: OCRApiClient,
    force_ocr: bool = False,
) -> tuple[str, str]:
    """Process a single job, updating the store. Returns ``(status, detail)``.

    Routing:
      * non-PDF files              → OCR API
      * PDF with ``not force_ocr`` and ``is_text_pdf`` True → pdftotext
      * PDF otherwise              → OCR API
    """
    path = job.file_path
    is_pdf = path.lower().endswith(".pdf")
    use_pdftotext = is_pdf and not force_ocr and is_text_pdf(path)
    process_type = "pdftotext" if use_pdftotext else "ocr_api"

    if not store.claim(job.id, process_type):
        # Another worker beat us to it (or status changed) — skip.
        return "skipped", "claim lost"

    LOG.info("[%s] 处理 %s (%s)", process_type, path, job.csv_row_id)

    try:
        if use_pdftotext:
            results = process_text_pdf(path)
        else:
            # OCR API: support crash recovery via persisted task_id
            if job.task_id:
                LOG.info("[ocr_api] 恢复轮询已有 task_id=%s", job.task_id)
                data = client.poll(job.task_id)
            else:
                task_id = client.upload(path)
                LOG.info("已提交 %s → task_id=%s", Path(path).name, task_id)
                store.save_task_id(job.id, task_id)
                data = client.poll(task_id)
            results = client._split_into_pages(data, path)
    except Exception as exc:
        store.mark_failed(job.id, str(exc))
        LOG.error("[%s] 失败 %s: %s", process_type, path, exc)
        return "failed", str(exc)

    store.mark_done(job.id, results)
    LOG.info("[%s] 完成 %s: %d 页", process_type, path, len(results))
    return "done", f"{len(results)} 页"


def worker(
    jobs: list[OcrJob],
    store: JobStore,
    client: OCRApiClient,
    force_ocr: bool,
    progress_cb: Any,
) -> None:
    """Process *jobs* sequentially on the calling thread."""
    try:
        for job in jobs:
            process_one(job, store, client, force_ocr=force_ocr)
            progress_cb()
    finally:
        store.close_thread()


# ─── CLI ──────────────────────────────────────────────────────────────────────

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ocr_pipeline.py",
        description=(
            "批量 OCR 流水线：CSV → 目录扫描 → 文本PDF直提 / 其余走 OCR API "
            "→ SQLite 存储（支持断点续传）。"
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--csv", required=True, type=Path,
                        help="输入 CSV，file_path 列指向目录或文件")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, type=Path,
                        help="SQLite 数据库路径")
    parser.add_argument("--workers", type=int, default=4,
                        help="并发线程数")
    parser.add_argument("--max-retries", type=int, default=3,
                        help="OCR API 单次提交最大重试次数（指数退避 2^n 秒）")
    parser.add_argument("--ocr-api", default=None,
                        help=f"OCR API 地址 (默认 {DEFAULT_OCR_API}，可由环境变量 "
                             f"OCR_API_BASE / BACKEND_URL 覆盖)")
    parser.add_argument("--processing-mode", default=DEFAULT_PROCESSING_MODE,
                        choices=("pipeline", "formula"),
                        help="backend processing_mode")
    parser.add_argument("--output-format", default=DEFAULT_OUTPUT_FORMAT,
                        help="backend 输出格式")
    parser.add_argument("--priority", type=int, default=DEFAULT_PRIORITY,
                        help="任务优先级 1=低 2=正常 3=高 4=紧急")
    parser.add_argument("--poll-interval", type=float, default=2.0,
                        help="轮询任务状态间隔（秒）")
    parser.add_argument("--max-wait", type=int, default=0,
                        help="单任务最大等待秒数，0=无限")
    parser.add_argument("--request-timeout", type=float, default=300.0,
                        help="HTTP 单请求超时（秒）")
    parser.add_argument("--force-ocr", action="store_true",
                        help="强制所有 PDF 走 OCR API（跳过文本 PDF 检测）")
    parser.add_argument("--log-dir", default=DEFAULT_LOG_DIR, type=Path,
                        help=f"日志目录（文件名固定 ocr_pipeline.log）")
    parser.add_argument("--log-level", default="INFO",
                        choices=("DEBUG", "INFO", "WARNING", "ERROR"))
    parser.add_argument("--env-file", default=None, type=Path,
                        help="可选 .env 路径（默认自动探测 ./deploy/.env 与 ./.env）")
    parser.add_argument("--limit", type=int, default=0,
                        help="本次最多处理的 job 数量（0=不限制，便于调试）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只扫描 CSV 与建库，不调用 OCR / pdftotext")
    return parser


def resolve_env_file(explicit: Optional[Path]) -> Path:
    """Pick the .env file to load: explicit flag, then repo defaults."""
    if explicit:
        return explicit
    for candidate in (Path("deploy/.env"), Path(".env")):
        if candidate.exists():
            return candidate
    return Path(".env")  # non-existent → load_dotenv_if_present becomes a no-op


def shard(items: list[OcrJob], n: int) -> list[list[OcrJob]]:
    """Split *items* into *n* roughly-equal contiguous chunks (round-robin)."""
    shards: list[list[OcrJob]] = [[] for _ in range(max(1, n))]
    for i, item in enumerate(items):
        shards[i % len(shards)].append(item)
    return [s for s in shards if s]


def main(argv: Optional[list[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)

    load_dotenv_if_present(resolve_env_file(args.env_file))
    setup_logging(args.log_dir / "ocr_pipeline.log", level=args.log_level)

    base_url = (
        args.ocr_api
        or os.environ.get("OCR_API_BASE")
        or os.environ.get("BACKEND_URL")
        or DEFAULT_OCR_API
    )

    LOG.info("==== OCR Pipeline 启动 %s ====", _utc_now_iso())
    LOG.info("CSV=%s  DB=%s  workers=%d  ocr_api=%s  max_retries=%d",
             args.csv, args.db, args.workers, base_url, args.max_retries)

    if not args.csv.exists():
        LOG.error("CSV 文件不存在: %s", args.csv)
        return 2

    # 1. discover + seed
    try:
        entries = discover_files(args.csv)
    except SystemExit:
        raise
    except Exception as exc:
        LOG.error("扫描 CSV 失败: %s", exc)
        return 2
    if not entries:
        LOG.warning("CSV 未发现任何可处理文件，退出。")
        return 0

    store = JobStore(args.db)
    store.seed_jobs(entries)
    store.reset_orphans()

    if args.dry_run:
        LOG.info("[dry-run] 共 %d 个文件已登记，跳过处理。", len(entries))
        print(json_dry_run_summary(store.stats(), len(entries)))
        return 0

    # 2. fetch pending + shard across workers
    pending = store.fetch_pending(args.max_retries, limit=args.limit)
    if not pending:
        LOG.info("没有待处理任务（全部已完成或重试预算耗尽）。")
        print_summary(store.stats())
        return 0
    LOG.info("本轮待处理 %d 个文件，分发给 %d 个 worker", len(pending), args.workers)

    client = OCRApiClient(
        base_url=base_url,
        processing_mode=args.processing_mode,
        output_format=args.output_format,
        priority=args.priority,
        poll_interval=args.poll_interval,
        request_timeout=args.request_timeout,
        max_retries=args.max_retries,
        max_wait_seconds=args.max_wait,
        cookie_file=args.db.parent / ".ocr_session_cookie",
    )

    shards = shard(pending, args.workers)
    progress = _Progress(len(pending))
    threads = []
    for i, chunk in enumerate(shards):
        t = threading.Thread(
            target=worker,
            name=f"ocr-worker-{i + 1}",
            args=(chunk, store, client, args.force_ocr, progress.tick),
            daemon=False,
        )
        threads.append(t)

    progress.start()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    progress.finish()

    LOG.info("==== 处理结束 %s ====", _utc_now_iso())
    print_summary(store.stats())
    return 0


class _Progress:
    """Tiny tqdm-backed progress coordinator (one bar across all workers)."""

    def __init__(self, total: int) -> None:
        self._total = total
        self._count = 0
        self._lock = threading.Lock()
        self._tqdm = None  # type: ignore[assignment]

    def start(self) -> None:
        if self._total <= 0:
            return
        tqdm = require_tqdm()
        self._tqdm = tqdm(total=self._total, desc="OCR", unit="file")

    def tick(self) -> None:
        with self._lock:
            self._count += 1
            done = self._count
        if self._tqdm is not None:
            self._tqdm.update(1)
            if done >= self._total:
                self._tqdm.close()

    def finish(self) -> None:
        # tqdm may have already self-closed if every tick fired; guard it.
        if self._tqdm is not None and self._tqdm.n < self._total:
            self._tqdm.close()


def print_summary(stats: dict[str, int]) -> None:
    total = sum(stats.values())
    parts = [f"{status}={count}" for status, count in sorted(stats.items())]
    print(f"\n汇总: {total} 个文件 — {', '.join(parts)}")


def json_dry_run_summary(stats: dict[str, int], discovered: int) -> str:
    import json
    return json.dumps(
        {"discovered": discovered, "jobs_by_status": stats},
        ensure_ascii=False,
        indent=2,
    )


if __name__ == "__main__":
    # close() silences “unused import” linters for contextlib helpers in some
    # static analyzers; keeping the symbol referenced.
    with closing(sys.stdin):
        raise SystemExit(main())
