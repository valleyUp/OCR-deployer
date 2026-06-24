#!/usr/bin/env python3
"""
Batch OCR pipeline: CSV → file scan → text-PDF / OCR-API routing → SQLite store.

Workflow
--------
1. Read a CSV whose ``file_path`` column points at one or more directories,
   or use ``--retry-db`` to retry pending/failed jobs from an existing DB.
2. Recursively scan each directory for supported files
   (``.pdf .jpg .jpeg .png .tiff .tif .bmp .webp``).
3. For every file:
   - If it is a *text* PDF (PyMuPDF extracts > 100 chars from the first 3
     pages) → extract text page-by-page with the system ``pdftotext`` tool.
   - Otherwise → submit to the local GLM-OCR backend
     (``POST /api/v1/tasks/upload`` then poll ``GET /api/v1/tasks/{task_id}``)
     with exponential-backoff retries.
4. Persist normalized file/job/page/run records to SQLite while keeping the
   legacy ``ocr_results`` page table populated for existing downstream queries.

The OCR backend speaks the GLM-OCR task API (see ``AGENTS.md``): multipart
upload returns a ``task_id``, polling returns ``full_markdown`` plus a
``layout`` array whose blocks carry a 1-based ``page_index``.  The anonymous
owner-cookie (``ocr_owner_token``) issued on first upload is stored and resent
automatically by :class:`requests.Session`, so no API key / JWT is required.

Resume semantics
----------------
All discovered files are ``INSERT OR IGNORE``-ed into ``ocr_files`` and
``ocr_jobs`` with ``status='pending'`` at startup.  Each run picks up
``status IN ('pending','failed') AND retry_count < max_retries`` rows, flips
them to ``'processing'`` (atomic claim), then to ``'done'`` or ``'failed'``.
Re-running the script therefore continues where it stopped.  Use
``--retry-db <path>`` when a CSV is not needed and you want to retry every
``pending`` / ``failed`` job already recorded in that database.

Dependencies: PyMuPDF, tqdm, requests, python-dotenv  (see scripts/requirements.txt).
"""

from __future__ import annotations

import argparse
import shutil
import csv
import json
import logging
import os
import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import closing, contextmanager
from concurrent.futures import ThreadPoolExecutor, as_completed
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
DEFAULT_PDF_RENDER_DPI = 200
DEFAULT_PDF_RENDER_WORKERS = 4

# Owner-cookie issued by the GLM-OCR backend (settings.OWNER_COOKIE_NAME).
OWNER_COOKIE_NAME = "ocr_owner_token"


LOG = logging.getLogger("ocr_pipeline")


def _file_record(path: str, csv_row_id: str = "") -> dict[str, Any]:
    """Return lightweight filesystem metadata for the canonical file table."""
    p = Path(path)
    try:
        stat = p.stat()
        file_size: Optional[int] = int(stat.st_size)
        mtime: Optional[float] = float(stat.st_mtime)
    except OSError:
        file_size = None
        mtime = None
    return {
        "file_path": str(p),
        "source_csv_row": csv_row_id,
        "file_name": p.name,
        "extension": p.suffix.lower(),
        "file_size": file_size,
        "mtime": mtime,
    }


def _positive_int(value: Any) -> Optional[int]:
    """Best-effort positive int parser for API/SQLite values."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _page_dimensions_from_task_data(
    data: dict[str, Any],
) -> dict[int, tuple[Optional[int], Optional[int]]]:
    """Extract page dimensions from a completed backend task payload."""
    dimensions: dict[int, tuple[Optional[int], Optional[int]]] = {}
    metadata = data.get("metadata") if isinstance(data, dict) else None
    if isinstance(metadata, dict):
        page_sizes = metadata.get("page_sizes")
        if isinstance(page_sizes, list):
            for fallback_index, item in enumerate(page_sizes, start=1):
                if not isinstance(item, dict):
                    continue
                page_index = _positive_int(item.get("page_index")) or fallback_index
                width = _positive_int(item.get("width"))
                height = _positive_int(item.get("height"))
                if width and height:
                    dimensions[page_index] = (width, height)
        if 1 not in dimensions:
            width = _positive_int(metadata.get("width"))
            height = _positive_int(metadata.get("height"))
            if width and height:
                dimensions[1] = (width, height)

    layout = data.get("layout") if isinstance(data, dict) else None
    if isinstance(layout, list):
        for block in layout:
            if not isinstance(block, dict):
                continue
            page_index = _positive_int(block.get("page_index")) or 1
            width = _positive_int(block.get("page_width"))
            height = _positive_int(block.get("page_height"))
            if width and height and page_index not in dimensions:
                dimensions[page_index] = (width, height)

    return dimensions


# ─── data structures ──────────────────────────────────────────────────────────

@dataclass(frozen=True)
class OcrJob:
    """A single unit of work tracked in the ``ocr_jobs`` table."""

    id: int
    file_id: Optional[int]
    csv_row_id: str
    file_path: str
    status: str
    process_type: str
    retry_count: int
    task_id: str = ""
    current_run_id: Optional[int] = None


@dataclass
class PageResult:
    """One page worth of recognised text to be stored in ``ocr_results``."""

    page_number: int
    content: str
    page_width: Optional[int] = None
    page_height: Optional[int] = None
    backend_task_id: str = ""


@dataclass(frozen=True)
class RenderedPdfPage:
    """A locally rendered PDF page image ready for OCR upload."""

    page_number: int
    image_path: str
    width: int
    height: int


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
CREATE TABLE IF NOT EXISTS ocr_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    mode           TEXT    NOT NULL,
    csv_path       TEXT,
    db_path        TEXT,
    ocr_api        TEXT,
    started_at     DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    completed_at   DATETIME,
    status         TEXT    NOT NULL DEFAULT 'running',
    discovered     INTEGER NOT NULL DEFAULT 0,
    jobs_total     INTEGER NOT NULL DEFAULT 0,
    stats_json     TEXT
);

CREATE TABLE IF NOT EXISTS ocr_files (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path      TEXT    NOT NULL UNIQUE,
    source_csv_row TEXT,
    file_name      TEXT,
    extension      TEXT,
    file_size      INTEGER,
    mtime          REAL,
    created_at     DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at     DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS ocr_jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id      INTEGER
                 REFERENCES ocr_files(id) ON DELETE CASCADE,
    current_run_id INTEGER
                 REFERENCES ocr_runs(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS ocr_pages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          INTEGER NOT NULL
                    REFERENCES ocr_jobs(id) ON DELETE CASCADE,
    file_id         INTEGER
                    REFERENCES ocr_files(id) ON DELETE CASCADE,
    page_number     INTEGER NOT NULL,
    content         TEXT,
    process_type    TEXT,
    backend_task_id TEXT,
    page_width      INTEGER,
    page_height     INTEGER,
    created_at      DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at      DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(job_id, page_number)
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

CREATE TABLE IF NOT EXISTS ocr_attempts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id         INTEGER
                   REFERENCES ocr_runs(id) ON DELETE SET NULL,
    job_id         INTEGER NOT NULL
                   REFERENCES ocr_jobs(id) ON DELETE CASCADE,
    file_id        INTEGER
                   REFERENCES ocr_files(id) ON DELETE CASCADE,
    process_type   TEXT,
    status         TEXT NOT NULL DEFAULT 'processing',
    task_id        TEXT,
    error_msg      TEXT,
    started_at     DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    finished_at    DATETIME
);

CREATE INDEX IF NOT EXISTS idx_ocr_files_path         ON ocr_files (file_path);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status       ON ocr_jobs (status);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_resume
    ON ocr_jobs (status, retry_count);
CREATE INDEX IF NOT EXISTS idx_ocr_pages_job_id      ON ocr_pages (job_id);
CREATE INDEX IF NOT EXISTS idx_ocr_pages_file_id     ON ocr_pages (file_id);
CREATE INDEX IF NOT EXISTS idx_ocr_results_job_id    ON ocr_results (job_id);
CREATE INDEX IF NOT EXISTS idx_ocr_results_file_path ON ocr_results (file_path);
CREATE INDEX IF NOT EXISTS idx_ocr_attempts_job_id   ON ocr_attempts (job_id);
CREATE INDEX IF NOT EXISTS idx_ocr_attempts_run_id   ON ocr_attempts (run_id);
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
        job_cols = JobStore._columns(conn, "ocr_jobs")
        if "task_id" not in job_cols:
            conn.execute("ALTER TABLE ocr_jobs ADD COLUMN task_id TEXT")
        if "file_id" not in job_cols:
            conn.execute("ALTER TABLE ocr_jobs ADD COLUMN file_id INTEGER")
        if "current_run_id" not in job_cols:
            conn.execute("ALTER TABLE ocr_jobs ADD COLUMN current_run_id INTEGER")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ocr_jobs_file_id "
            "ON ocr_jobs (file_id)"
        )

        for row in conn.execute("SELECT id, csv_row_id, file_path FROM ocr_jobs"):
            file_id = JobStore._upsert_file(
                conn,
                row["file_path"],
                row["csv_row_id"],
            )
            conn.execute(
                "UPDATE ocr_jobs SET file_id=? WHERE id=? AND file_id IS NULL",
                (file_id, row["id"]),
            )

        csv_table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='csv_data'"
        ).fetchone()
        if csv_table:
            csv_cols = JobStore._columns(conn, "csv_data")
            if "file_id" not in csv_cols:
                conn.execute("ALTER TABLE csv_data ADD COLUMN file_id INTEGER")
            if "file_path" not in csv_cols:
                conn.execute("ALTER TABLE csv_data ADD COLUMN file_path TEXT")
            conn.execute(
                "UPDATE csv_data "
                "SET file_id=(SELECT ocr_jobs.file_id "
                "             FROM ocr_jobs "
                "             WHERE ocr_jobs.id=csv_data.job_id) "
                "WHERE file_id IS NULL"
            )
            conn.execute(
                "UPDATE csv_data "
                "SET file_path=(SELECT ocr_jobs.file_path "
                "               FROM ocr_jobs "
                "               WHERE ocr_jobs.id=csv_data.job_id) "
                "WHERE file_path IS NULL OR file_path=''"
            )
        JobStore._backfill_pages(conn)

    @staticmethod
    def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
        """Return column names for *table*."""
        return {row[1] for row in conn.execute(f"PRAGMA table_info({_quote_ident(table)})")}

    @staticmethod
    def _upsert_file(
        conn: sqlite3.Connection,
        file_path: str,
        csv_row_id: str = "",
    ) -> int:
        """Insert/update ``ocr_files`` and return its id."""
        record = _file_record(file_path, csv_row_id)
        conn.execute(
            "INSERT OR IGNORE INTO ocr_files "
            "(file_path, source_csv_row, file_name, extension, file_size, mtime) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                record["file_path"],
                record["source_csv_row"],
                record["file_name"],
                record["extension"],
                record["file_size"],
                record["mtime"],
            ),
        )
        conn.execute(
            "UPDATE ocr_files "
            "SET source_csv_row=COALESCE(NULLIF(?, ''), source_csv_row), "
            "    file_name=?, extension=?, file_size=?, mtime=?, "
            "    updated_at=CURRENT_TIMESTAMP "
            "WHERE file_path=?",
            (
                csv_row_id,
                record["file_name"],
                record["extension"],
                record["file_size"],
                record["mtime"],
                record["file_path"],
            ),
        )
        row = conn.execute(
            "SELECT id FROM ocr_files WHERE file_path=?",
            (record["file_path"],),
        ).fetchone()
        if not row:
            raise RuntimeError(f"无法创建 ocr_files 记录: {file_path}")
        return int(row["id"])

    @staticmethod
    def _backfill_pages(conn: sqlite3.Connection) -> None:
        """Backfill canonical page rows from legacy ``ocr_results``."""
        table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ocr_results'"
        ).fetchone()
        if not table:
            return

        rows = conn.execute(
            "SELECT r.job_id, r.file_path, r.page_number, r.content, "
            "       j.file_id, j.process_type, j.task_id "
            "FROM ocr_results r "
            "LEFT JOIN ocr_jobs j ON j.id=r.job_id "
            "ORDER BY r.id"
        ).fetchall()
        for row in rows:
            conn.execute(
                "INSERT OR IGNORE INTO ocr_pages "
                "(job_id, file_id, page_number, content, process_type, "
                " backend_task_id) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    row["job_id"],
                    row["file_id"],
                    row["page_number"],
                    row["content"],
                    row["process_type"],
                    row["task_id"],
                ),
            )

    @contextmanager
    def _cursor(self) -> Iterator[sqlite3.Cursor]:
        conn = getattr(self._tls, "conn", None)
        if conn is None:
            conn = open_database(self._db_path)
            self._tls.conn = conn
        yield conn.cursor()

    # ── discovery / seeding ───────────────────────────────────────────────────

    def seed_jobs(
        self,
        entries: list[dict[str, Any]],
        col_names: list[str] | None = None,
        col_types: dict[str, str] | None = None,
    ) -> int:
        """Insert job entries and their CSV metadata, ignoring duplicates.

        Creates the ``csv_data`` table (if needed) with typed columns derived
        from *col_types*.  Returns the number of newly inserted rows.
        """
        if not entries:
            return 0

        col_names = col_names or []
        col_types = col_types or {}

        csv_extra_cols = [
            c for c in col_names
            if c not in {"job_id", "file_id", "file_path"}
        ]

        # -- create csv_data table on first run --------------------------------
        if col_names:
            col_defs = ", ".join(
                f"{_quote_ident(c)} {col_types.get(c, 'TEXT')}"
                for c in csv_extra_cols
            )
            extra_sql = f", {col_defs}" if col_defs else ""
            ddl = (
                "CREATE TABLE IF NOT EXISTS csv_data ("
                "  job_id INTEGER PRIMARY KEY"
                "    REFERENCES ocr_jobs(id) ON DELETE CASCADE,"
                "  file_id INTEGER,"
                "  file_path TEXT"
                f"{extra_sql}"
                ")"
            )
            with self._cursor() as cur:
                cur.connection.execute(ddl)
                self._ensure_csv_data_columns(
                    cur.connection,
                    csv_extra_cols,
                    col_types,
                )

        # -- insert ocr_jobs ---------------------------------------------------
        inserted = 0
        with self._cursor() as cur:
            conn = cur.connection
            conn.execute("BEGIN")
            try:
                for entry in entries:
                    file_id = self._upsert_file(
                        conn,
                        entry["file_path"],
                        entry["csv_row_id"],
                    )
                    cur.execute(
                        "INSERT OR IGNORE INTO ocr_jobs "
                        "(file_id, csv_row_id, file_path, status) "
                        "VALUES (?, ?, ?, 'pending')",
                        (file_id, entry["csv_row_id"], entry["file_path"]),
                    )
                    if cur.rowcount == 1:
                        inserted += 1
                        job_id = cur.lastrowid
                    else:
                        row = cur.execute(
                            "SELECT id FROM ocr_jobs WHERE file_path=?",
                            (entry["file_path"],),
                        ).fetchone()
                        if not row:
                            continue
                        job_id = row["id"]
                        cur.execute(
                            "UPDATE ocr_jobs "
                            "SET file_id=?, csv_row_id=?, updated_at=CURRENT_TIMESTAMP "
                            "WHERE id=?",
                            (file_id, entry["csv_row_id"], job_id),
                        )

                    if col_names and entry.get("csv_data"):
                        placeholders = ", ".join("?" for _ in csv_extra_cols)
                        cols_sql = ", ".join(
                            _quote_ident(c) for c in csv_extra_cols
                        )
                        values = self._coerce_row(
                            entry["csv_data"], csv_extra_cols, col_types
                        )
                        raw_csv_path = entry["csv_data"].get("file_path", "")
                        if csv_extra_cols:
                            cur.execute(
                                "INSERT OR IGNORE INTO csv_data "
                                f"(job_id, file_id, file_path, {cols_sql}) "
                                f"VALUES (?, ?, ?, {placeholders})",
                                [job_id, file_id, raw_csv_path, *values],
                            )
                        else:
                            cur.execute(
                                "INSERT OR IGNORE INTO csv_data "
                                "(job_id, file_id, file_path) VALUES (?, ?, ?)",
                                (job_id, file_id, raw_csv_path),
                            )
                        cur.execute(
                            "UPDATE csv_data "
                            "SET file_id=?, file_path=? "
                            "WHERE job_id=? AND "
                            "      (file_id IS NULL OR file_path IS NULL "
                            "       OR file_path='')",
                            (file_id, raw_csv_path, job_id),
                        )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

        LOG.info("Seeded %d new job(s) (%d total unique paths, %d csv columns)",
                 inserted, len(entries), len(col_names))
        return inserted

    @staticmethod
    def _ensure_csv_data_columns(
        conn: sqlite3.Connection,
        col_names: list[str],
        col_types: dict[str, str],
    ) -> None:
        """Add newly discovered CSV columns to an existing ``csv_data`` table."""
        existing = {
            row[1] for row in conn.execute("PRAGMA table_info(csv_data)")
        }
        for name in col_names:
            if name in {"job_id", "file_id", "file_path"}:
                continue
            if name in existing:
                continue
            ctype = col_types.get(name, "TEXT")
            conn.execute(
                f"ALTER TABLE csv_data ADD COLUMN {_quote_ident(name)} {ctype}"
            )
            existing.add(name)

    @staticmethod
    def _coerce_row(
        csv_data: dict[str, str],
        col_names: list[str],
        col_types: dict[str, str],
    ) -> list[Any]:
        """Convert raw CSV strings to typed Python values matching *col_types*."""
        values: list[Any] = []
        for c in col_names:
            raw = csv_data.get(c, "")
            if not raw or not raw.strip():
                values.append(None)
                continue
            raw = raw.strip()
            ctype = col_types.get(c, "TEXT")
            if ctype == "INTEGER":
                try:
                    values.append(int(raw))
                except ValueError:
                    values.append(raw)
            elif ctype == "REAL":
                try:
                    values.append(float(raw))
                except ValueError:
                    values.append(raw)
            else:
                values.append(raw)
        return values

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

    def start_run(
        self,
        *,
        mode: str,
        csv_path: Optional[Path],
        db_path: Path,
        ocr_api: str,
        discovered: int = 0,
    ) -> int:
        """Create a durable record for one script invocation."""
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO ocr_runs "
                "(mode, csv_path, db_path, ocr_api, discovered) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    mode,
                    str(csv_path) if csv_path else None,
                    str(db_path),
                    ocr_api,
                    discovered,
                ),
            )
            return int(cur.lastrowid)

    def update_run_discovered(self, run_id: int, discovered: int) -> None:
        """Update how many source files were discovered for this run."""
        with self._cursor() as cur:
            cur.execute(
                "UPDATE ocr_runs SET discovered=? WHERE id=?",
                (discovered, run_id),
            )

    def finish_run(
        self,
        run_id: int,
        *,
        status: str,
        jobs_total: int = 0,
        stats: Optional[dict[str, int]] = None,
    ) -> None:
        """Mark a run complete and store a compact stats snapshot."""
        with self._cursor() as cur:
            cur.execute(
                "UPDATE ocr_runs "
                "SET completed_at=CURRENT_TIMESTAMP, status=?, jobs_total=?, "
                "    stats_json=? "
                "WHERE id=?",
                (
                    status,
                    jobs_total,
                    json.dumps(stats or {}, ensure_ascii=False),
                    run_id,
                ),
            )

    def start_attempt(
        self,
        run_id: Optional[int],
        job: OcrJob,
        process_type: str,
    ) -> int:
        """Create a per-job attempt record for the current run."""
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO ocr_attempts "
                "(run_id, job_id, file_id, process_type, status, task_id) "
                "VALUES (?, ?, ?, ?, 'processing', ?)",
                (run_id, job.id, job.file_id, process_type, job.task_id or None),
            )
            return int(cur.lastrowid)

    def finish_attempt(
        self,
        attempt_id: Optional[int],
        *,
        status: str,
        task_id: str = "",
        error_msg: str = "",
    ) -> None:
        """Finish a per-job attempt if one was created."""
        if attempt_id is None:
            return
        truncated = (error_msg or "")[:2000]
        with self._cursor() as cur:
            cur.execute(
                "UPDATE ocr_attempts "
                "SET status=?, task_id=COALESCE(NULLIF(?, ''), task_id), "
                "    error_msg=?, finished_at=CURRENT_TIMESTAMP "
                "WHERE id=?",
                (status, task_id, truncated or None, attempt_id),
            )

    def save_task_id(
        self,
        job_id: int,
        task_id: str,
        attempt_id: Optional[int] = None,
    ) -> None:
        """Persist the backend task_id so polling can resume after a crash."""
        with self._cursor() as cur:
            cur.execute(
                "UPDATE ocr_jobs SET task_id=?, updated_at=CURRENT_TIMESTAMP "
                "WHERE id=?",
                (task_id, job_id),
            )
            if attempt_id is not None:
                cur.execute(
                    "UPDATE ocr_attempts SET task_id=? WHERE id=?",
                    (task_id, attempt_id),
                )

    # ── claim / fetch ─────────────────────────────────────────────────────────

    def fetch_pending(
        self,
        max_retries: int,
        limit: int = 0,
        *,
        ignore_retry_budget: bool = False,
    ) -> list[OcrJob]:
        """Return jobs eligible for processing this run.

        Eligible = ``status IN ('pending','failed')`` and the file-level
        retry budget is not exhausted (``retry_count < max_retries``), unless
        *ignore_retry_budget* is true.
        """
        sql = (
            "SELECT id, file_id, csv_row_id, file_path, status, "
            "       COALESCE(process_type, '') AS process_type, retry_count, "
            "       COALESCE(task_id, '') AS task_id, current_run_id "
            "FROM ocr_jobs "
            "WHERE status IN ('pending', 'failed') "
        )
        params: list[Any] = []
        if not ignore_retry_budget:
            sql += "  AND retry_count < ? "
            params.append(max_retries)
        sql += "ORDER BY id"
        if limit and limit > 0:
            sql += " LIMIT ?"
            params.append(limit)
        with self._cursor() as cur:
            cur.execute(sql, params)
            return [OcrJob(**row) for row in cur.fetchall()]

    def prepare_pending_failed_retry(self) -> int:
        """Reset pending/failed jobs so they can be retried from this DB.

        Failed jobs may carry a terminal backend ``task_id``.  Clearing it
        forces a fresh upload instead of polling the same failed task forever.
        Pending jobs are also cleared so an explicit retry run is deterministic.
        """
        with self._cursor() as cur:
            conn = cur.connection
            conn.execute("BEGIN")
            try:
                cur.execute(
                    "UPDATE ocr_jobs "
                    "SET status='pending', retry_count=0, error_msg=NULL, "
                    "    task_id=NULL, updated_at=CURRENT_TIMESTAMP "
                    "WHERE status IN ('pending', 'failed')"
                )
                count = cur.rowcount if cur.rowcount != -1 else 0
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        LOG.info("已准备重试 %d 个 pending/failed job", count)
        return count

    def claim(
        self,
        job_id: int,
        process_type: str,
        run_id: Optional[int] = None,
    ) -> bool:
        """Atomically flip a job to ``processing``.

        The ``WHERE status IN (...)`` guard makes the claim safe even if two
        threads somehow targeted the same row.
        """
        with self._cursor() as cur:
            cur.execute(
                "UPDATE ocr_jobs "
                "SET status='processing', process_type=?, current_run_id=?, "
                "    updated_at=CURRENT_TIMESTAMP "
                "WHERE id=? AND status IN ('pending', 'failed')",
                (process_type, run_id, job_id),
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
                    "SELECT csv_row_id, file_path, file_id, process_type, task_id "
                    "FROM ocr_jobs WHERE id=?",
                    (job_id,),
                )
                row = cur.fetchone()
                csv_row_id = row["csv_row_id"] if row else ""
                file_path = row["file_path"] if row else ""
                file_id = row["file_id"] if row else None
                process_type = row["process_type"] if row else None
                job_task_id = row["task_id"] if row else ""

                cur.execute("DELETE FROM ocr_pages WHERE job_id=?", (job_id,))
                cur.execute("DELETE FROM ocr_results WHERE job_id=?", (job_id,))

                if results:
                    cur.executemany(
                        "INSERT INTO ocr_pages "
                        "(job_id, file_id, page_number, content, process_type, "
                        " backend_task_id, page_width, page_height) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        [
                            (
                                job_id,
                                file_id,
                                r.page_number,
                                r.content,
                                process_type,
                                r.backend_task_id or job_task_id,
                                r.page_width,
                                r.page_height,
                            )
                            for r in results
                        ],
                    )
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

    def get_csv_data(self, job_id: int) -> dict[str, Any] | None:
        """Return the CSV metadata row for *job_id*, or ``None`` if absent."""
        with self._cursor() as cur:
            # Check csv_data table exists before querying
            tables = cur.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name='csv_data'"
            ).fetchone()
            if not tables:
                return None
            row = cur.execute(
                "SELECT * FROM csv_data WHERE job_id=?", (job_id,)
            ).fetchone()
            return dict(row) if row else None

    def csv_columns(self) -> list[dict[str, str]]:
        """Return column metadata for the ``csv_data`` table (name + type)."""
        with self._cursor() as cur:
            tables = cur.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name='csv_data'"
            ).fetchone()
            if not tables:
                return []
            rows = cur.execute("PRAGMA table_info(csv_data)").fetchall()
            return [
                {"name": r["name"], "type": r["type"]}
                for r in rows
                if r["name"] != "job_id"
            ]

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


def _detect_column_types(
    rows: list[dict[str, str]],
    skip_cols: set[str],
) -> dict[str, str]:
    """Analyse CSV values and classify each column as ``INTEGER``, ``REAL``, or ``TEXT``.

    Columns in *skip_cols* (``id`` / row identifiers, etc.) are excluded from
    the result.  The CSV path column is intentionally kept in ``csv_data`` so
    the source row remains inspectable even though the discovered file path is
    also stored in ``ocr_jobs``.

    Type detection logic per column:
      * All non-empty values parse as ``int``   → ``INTEGER``
      * All non-empty values parse as ``float`` → ``REAL`` (covers monetary amounts)
      * Otherwise                               → ``TEXT``
    """
    if not rows:
        return {}

    cols = [c for c in rows[0] if c and c not in skip_cols]
    types: dict[str, str] = {}

    for col in cols:
        is_int = True
        is_float = True
        has_value = False

        for row in rows:
            val = (row.get(col) or "").strip()
            if not val:
                continue
            has_value = True
            if is_int:
                try:
                    int(val)
                except ValueError:
                    is_int = False
            if is_float:
                try:
                    float(val)
                except ValueError:
                    is_float = False
            if not is_int and not is_float:
                break

        if not has_value:
            types[col] = "TEXT"
        elif is_int:
            types[col] = "INTEGER"
        elif is_float:
            types[col] = "REAL"
        else:
            types[col] = "TEXT"

    return types


def _quote_ident(name: str) -> str:
    """Double-quote a SQL identifier, escaping embedded quotes."""
    return '"' + name.replace('"', '""') + '"'


def discover_files(
    csv_path: Path,
) -> tuple[list[dict[str, Any]], list[str], dict[str, str]]:
    """Expand the CSV into job entries, detecting column types.

    Returns ``(entries, col_names, col_types)`` where:

    * *entries* is a list of dicts with ``csv_row_id``, the discovered
      ``file_path``, and ``csv_data`` (CSV metadata for that row).
    * *col_names* preserves the original CSV column order (excluding the row id
      column) and always includes a normalized ``file_path`` column.
    * *col_types* maps each extra column to its detected SQLite type
      (``INTEGER``, ``REAL``, or ``TEXT``).

    When a row's ``file_path`` is a directory every discovered file inherits
    the same CSV metadata from the originating row, including the original
    CSV path value in ``csv_data.file_path``.
    """
    rows_iter = _iter_csv_rows(csv_path)
    first = next(rows_iter, None)
    if first is None:
        raise SystemExit(f"CSV 文件为空或没有数据行: {csv_path}")

    fieldnames = list(first.keys())
    path_col = _pick_path_column(fieldnames)
    id_col = _pick_id_column(fieldnames)
    skip_cols = {c for c in (id_col,) if c}

    all_rows = [first, *rows_iter]
    col_types = _detect_column_types(all_rows, skip_cols)
    col_types[path_col] = "TEXT"
    col_types["file_path"] = "TEXT"

    col_names = [c for c in fieldnames if c and c not in skip_cols]
    if "file_path" not in col_names:
        col_names.insert(0, "file_path")

    entries: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add(row_id: str, abs_path: str, csv_data: dict[str, str]) -> None:
        if abs_path in seen:
            return
        seen.add(abs_path)
        entries.append({
            "csv_row_id": row_id,
            "file_path": abs_path,
            "csv_data": csv_data,
        })

    line_no = 1  # header is line 1; first data row is line 2
    for row in all_rows:
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

        csv_data = {c: (row.get(c) or "") for c in col_names}
        csv_data["file_path"] = raw

        if target.is_file():
            if target.suffix.lower() in SUPPORTED_EXTS:
                _add(row_id, str(target.resolve()), csv_data)
            else:
                LOG.warning("CSV 第 %d 行文件扩展名不支持: %s", line_no, raw)
            continue

        # directory → recursive walk
        for root, _dirs, files in os.walk(target):
            for name in sorted(files):
                if Path(name).suffix.lower() in SUPPORTED_EXTS:
                    _add(row_id, str(Path(root, name).resolve()), csv_data)

    return entries, col_names, col_types


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


def _render_pdf_page(
    pdf_path: str,
    output_dir: Path,
    page_number: int,
    dpi: int,
) -> RenderedPdfPage:
    """Render one PDF page to PNG without resizing it to another page."""
    fitz = require_fitz()
    zoom = dpi / 72.0
    output_path = output_dir / f"page_{page_number:04d}.png"

    with fitz.open(pdf_path) as doc:  # type: ignore[attr-defined]
        page = doc[page_number - 1]
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        pix.save(str(output_path))
        return RenderedPdfPage(
            page_number=page_number,
            image_path=str(output_path),
            width=int(pix.width),
            height=int(pix.height),
        )


def render_pdf_pages_locally(
    pdf_path: str,
    output_dir: Path,
    *,
    dpi: int = DEFAULT_PDF_RENDER_DPI,
    workers: int = DEFAULT_PDF_RENDER_WORKERS,
) -> list[RenderedPdfPage]:
    """Render all PDF pages locally in parallel.

    This intentionally does not normalize page sizes.  The current backend
    resizes pages because it records only the first page's dimensions for bbox
    conversion; local rendering should preserve each page's own dimensions so a
    later page-aware result schema can store exact geometry.
    """
    page_count = _pdf_page_count(pdf_path)
    if page_count < 1:
        raise RuntimeError(f"PDF 无有效页: {pdf_path}")

    output_dir.mkdir(parents=True, exist_ok=True)
    worker_count = max(1, min(int(workers), page_count))
    safe_dpi = max(36, int(dpi))

    LOG.info(
        "本地渲染 PDF: %s (%d 页, dpi=%d, workers=%d)",
        pdf_path,
        page_count,
        safe_dpi,
        worker_count,
    )

    if worker_count == 1:
        pages = [
            _render_pdf_page(pdf_path, output_dir, page, safe_dpi)
            for page in range(1, page_count + 1)
        ]
    else:
        pages = []
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            futures = {
                pool.submit(_render_pdf_page, pdf_path, output_dir, page, safe_dpi):
                page
                for page in range(1, page_count + 1)
            }
            for future in as_completed(futures):
                page = futures[future]
                try:
                    pages.append(future.result())
                except Exception as exc:
                    raise RuntimeError(f"本地渲染 PDF 第 {page} 页失败: {exc}") from exc
        pages.sort(key=lambda item: item.page_number)

    LOG.info("本地 PDF 渲染完成: %d 页 -> %s", len(pages), output_dir)
    return pages


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
        return self._split_into_pages(data, file_path, task_id=task_id)

    @staticmethod
    def _split_into_pages(
        data: dict[str, Any],
        file_path: str,
        *,
        task_id: str = "",
    ) -> list[PageResult]:
        """Turn a completed-task payload into per-page :class:`PageResult`.

        Layout blocks carry a 1-based ``page_index``; we group their
        ``block_content`` by page.  If no layout blocks are present we fall
        back to ``full_markdown`` as page 1 (this also covers single-image
        inputs, which are always page 1).
        """
        layout = data.get("layout")
        results: list[PageResult] = []
        page_dimensions = _page_dimensions_from_task_data(data)

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
                width, height = page_dimensions.get(page_number, (None, None))
                results.append(
                    PageResult(
                        page_number,
                        "\n\n".join(pages[page_number]).strip(),
                        page_width=width,
                        page_height=height,
                        backend_task_id=task_id,
                    )
                )

        if not results:
            width, height = page_dimensions.get(1, (None, None))
            markdown = (data.get("full_markdown") or "").strip()
            if markdown:
                results.append(
                    PageResult(
                        1,
                        markdown,
                        page_width=width,
                        page_height=height,
                        backend_task_id=task_id,
                    )
                )
            else:
                LOG.warning("%s OCR 返回空内容 (无 layout / full_markdown)", file_path)
                results.append(
                    PageResult(
                        1,
                        "",
                        page_width=width,
                        page_height=height,
                        backend_task_id=task_id,
                    )
                )
        return results


def process_rendered_pdf_pages(
    client: OCRApiClient,
    pages: list[RenderedPdfPage],
    source_pdf: str,
) -> list[PageResult]:
    """OCR locally rendered PDF pages one by one and map them to source pages."""
    results: list[PageResult] = []
    total = len(pages)
    for rendered in pages:
        task_id = client.upload(rendered.image_path)
        LOG.info(
            "[local_pdf_pages] 已提交 %s 第 %d/%d 页 (%dx%d) → task_id=%s",
            Path(source_pdf).name,
            rendered.page_number,
            total,
            rendered.width,
            rendered.height,
            task_id,
        )
        data = client.poll(task_id)
        page_results = client._split_into_pages(
            data,
            rendered.image_path,
            task_id=task_id,
        )
        content = "\n\n".join(
            page.content for page in page_results if page.content
        ).strip()
        results.append(
            PageResult(
                rendered.page_number,
                content,
                page_width=rendered.width,
                page_height=rendered.height,
                backend_task_id=task_id,
            )
        )
    return results


# ─── worker ───────────────────────────────────────────────────────────────────

def process_one(
    job: OcrJob,
    store: JobStore,
    client: OCRApiClient,
    run_id: Optional[int],
    force_ocr: bool = False,
    local_pdf_pages: bool = False,
    pdf_render_dir: Optional[Path] = None,
    pdf_render_dpi: int = DEFAULT_PDF_RENDER_DPI,
    pdf_render_workers: int = DEFAULT_PDF_RENDER_WORKERS,
    keep_rendered_pages: bool = False,
) -> tuple[str, str]:
    """Process a single job, updating the store. Returns ``(status, detail)``.

    Routing:
      * non-PDF files              → OCR API
      * PDF with ``not force_ocr`` and ``is_text_pdf`` True → pdftotext
      * PDF with ``local_pdf_pages`` enabled → local render pages, then OCR API
      * PDF otherwise              → OCR API
    """
    path = job.file_path
    is_pdf = path.lower().endswith(".pdf")
    use_pdftotext = is_pdf and not force_ocr and is_text_pdf(path)
    use_local_pdf_pages = is_pdf and not use_pdftotext and local_pdf_pages
    if use_pdftotext:
        process_type = "pdftotext"
    elif use_local_pdf_pages:
        process_type = "local_pdf_pages"
    else:
        process_type = "ocr_api"

    if not store.claim(job.id, process_type, run_id=run_id):
        # Another worker beat us to it (or status changed) — skip.
        return "skipped", "claim lost"
    attempt_id = store.start_attempt(run_id, job, process_type)

    LOG.info("[%s] 处理 %s (%s)", process_type, path, job.csv_row_id)

    render_dir_for_cleanup: Optional[Path] = None
    attempt_task_id = job.task_id or ""
    try:
        if use_pdftotext:
            results = process_text_pdf(path)
        elif use_local_pdf_pages:
            if pdf_render_dir is None:
                raise RuntimeError("未配置本地 PDF 渲染目录")
            safe_stem = "".join(
                ch if ch.isalnum() or ch in ("-", "_") else "_"
                for ch in Path(path).stem
            )[:80] or "pdf"
            render_dir = pdf_render_dir / f"job_{job.id}_{safe_stem}"
            if render_dir.exists():
                shutil.rmtree(render_dir, ignore_errors=True)
            render_dir_for_cleanup = render_dir
            rendered_pages = render_pdf_pages_locally(
                path,
                render_dir,
                dpi=pdf_render_dpi,
                workers=pdf_render_workers,
            )
            results = process_rendered_pdf_pages(client, rendered_pages, path)
        else:
            # OCR API: support crash recovery via persisted task_id
            if job.task_id:
                LOG.info("[ocr_api] 恢复轮询已有 task_id=%s", job.task_id)
                data = client.poll(job.task_id)
            else:
                task_id = client.upload(path)
                attempt_task_id = task_id
                LOG.info("已提交 %s → task_id=%s", Path(path).name, task_id)
                store.save_task_id(job.id, task_id, attempt_id=attempt_id)
                data = client.poll(task_id)
            results = client._split_into_pages(
                data,
                path,
                task_id=attempt_task_id,
            )
        if not attempt_task_id:
            attempt_task_id = next(
                (r.backend_task_id for r in results if r.backend_task_id),
                "",
            )
        store.mark_done(job.id, results)
        store.finish_attempt(attempt_id, status="done", task_id=attempt_task_id)
        LOG.info("[%s] 完成 %s: %d 页", process_type, path, len(results))
        return "done", f"{len(results)} 页"
    except Exception as exc:
        store.mark_failed(job.id, str(exc))
        store.finish_attempt(
            attempt_id,
            status="failed",
            task_id=attempt_task_id,
            error_msg=str(exc),
        )
        LOG.error("[%s] 失败 %s: %s", process_type, path, exc)
        return "failed", str(exc)
    finally:
        if render_dir_for_cleanup is not None and not keep_rendered_pages:
            shutil.rmtree(render_dir_for_cleanup, ignore_errors=True)


def worker(
    jobs: list[OcrJob],
    store: JobStore,
    client: OCRApiClient,
    run_id: Optional[int],
    force_ocr: bool,
    local_pdf_pages: bool,
    pdf_render_dir: Optional[Path],
    pdf_render_dpi: int,
    pdf_render_workers: int,
    keep_rendered_pages: bool,
    progress_cb: Any,
) -> None:
    """Process *jobs* sequentially on the calling thread."""
    try:
        for job in jobs:
            process_one(
                job,
                store,
                client,
                run_id,
                force_ocr=force_ocr,
                local_pdf_pages=local_pdf_pages,
                pdf_render_dir=pdf_render_dir,
                pdf_render_dpi=pdf_render_dpi,
                pdf_render_workers=pdf_render_workers,
                keep_rendered_pages=keep_rendered_pages,
            )
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
    parser.add_argument("--csv", type=Path,
                        help="输入 CSV，file_path 列指向目录或文件")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, type=Path,
                        help="SQLite 数据库路径")
    parser.add_argument("--retry-db", type=Path,
                        help="直接从指定 SQLite 数据库重试所有 pending/failed 任务（无需 --csv）")
    parser.add_argument("--retry-existing", action="store_true",
                        help="跳过 CSV 扫描，重试 --db 中所有 pending/failed 任务")
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
    parser.add_argument("--local-pdf-pages", action="store_true",
                        help="非文本 PDF 先在本地并行渲染为单页图片，再逐页上传 OCR")
    parser.add_argument("--pdf-render-dir", type=Path, default=None,
                        help="本地 PDF 单页图片缓存目录（默认 <db目录>/ocr_pdf_pages）")
    parser.add_argument("--pdf-render-dpi", type=int, default=DEFAULT_PDF_RENDER_DPI,
                        help="本地 PDF 渲染 DPI")
    parser.add_argument("--pdf-render-workers", type=int,
                        default=DEFAULT_PDF_RENDER_WORKERS,
                        help="每个 PDF 本地渲染并发线程数")
    parser.add_argument("--keep-rendered-pages", action="store_true",
                        help="保留本地渲染出的单页图片，便于调试或复查")
    parser.add_argument("--log-dir", default=DEFAULT_LOG_DIR, type=Path,
                        help=f"日志目录（文件名固定 ocr_pipeline.log）")
    parser.add_argument("--log-level", default="INFO",
                        choices=("DEBUG", "INFO", "WARNING", "ERROR"))
    parser.add_argument("--env-file", default=None, type=Path,
                        help="可选 .env 路径（默认自动探测 ./deploy/.env 与 ./.env）")
    parser.add_argument("--limit", type=int, default=0,
                        help="本次最多处理的 job 数量（0=不限制，便于调试）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只准备/登记任务，不调用 OCR / pdftotext")
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
    retry_existing = bool(args.retry_existing or args.retry_db)
    if args.retry_db:
        args.db = args.retry_db

    load_dotenv_if_present(resolve_env_file(args.env_file))
    setup_logging(args.log_dir / "ocr_pipeline.log", level=args.log_level)

    base_url = (
        args.ocr_api
        or os.environ.get("OCR_API_BASE")
        or os.environ.get("BACKEND_URL")
        or DEFAULT_OCR_API
    )

    LOG.info("==== OCR Pipeline 启动 %s ====", _utc_now_iso())
    LOG.info("mode=%s  CSV=%s  DB=%s  workers=%d  ocr_api=%s  max_retries=%d",
             "retry-db" if retry_existing else "csv",
             args.csv, args.db, args.workers, base_url, args.max_retries)
    pdf_render_dir = (
        (args.pdf_render_dir or args.db.parent / "ocr_pdf_pages").resolve()
        if args.local_pdf_pages
        else None
    )
    if args.local_pdf_pages:
        LOG.info(
            "local_pdf_pages=on  render_dir=%s  dpi=%d  render_workers=%d",
            pdf_render_dir,
            args.pdf_render_dpi,
            args.pdf_render_workers,
        )

    if retry_existing and not args.db.exists():
        LOG.error("重试数据库不存在: %s", args.db)
        return 2
    if not retry_existing and not args.csv:
        LOG.error("缺少 --csv；如需从已有数据库重试，请使用 --retry-db <db> 或 --retry-existing --db <db>")
        return 2
    if not retry_existing and not args.csv.exists():
        LOG.error("CSV 文件不存在: %s", args.csv)
        return 2

    store = JobStore(args.db)
    run_id = store.start_run(
        mode="retry-db" if retry_existing else "csv",
        csv_path=None if retry_existing else args.csv,
        db_path=args.db,
        ocr_api=base_url,
    )
    discovered = 0
    col_types: dict[str, str] = {}

    if retry_existing:
        store.reset_orphans()
        prepared = store.prepare_pending_failed_retry()
        if prepared == 0:
            LOG.info("指定数据库中没有 pending/failed 任务。")
    else:
        # 1. discover + seed
        try:
            entries, col_names, col_types = discover_files(args.csv)
        except SystemExit:
            store.finish_run(run_id, status="failed", stats=store.stats())
            raise
        except Exception as exc:
            LOG.error("扫描 CSV 失败: %s", exc)
            store.finish_run(run_id, status="failed", stats=store.stats())
            return 2
        if not entries:
            LOG.warning("CSV 未发现任何可处理文件，退出。")
            store.finish_run(run_id, status="empty", stats=store.stats())
            return 0

        discovered = len(entries)
        store.update_run_discovered(run_id, discovered)
        store.seed_jobs(entries, col_names, col_types)
        store.reset_orphans()

    if args.dry_run:
        stats = store.stats()
        store.finish_run(run_id, status="dry_run", stats=stats)
        if retry_existing:
            LOG.info("[dry-run] 已准备指定数据库中的 pending/failed 任务，跳过处理。")
        else:
            LOG.info("[dry-run] 共 %d 个文件已登记，跳过处理。", discovered)
        print(json_dry_run_summary(stats, discovered, col_types))
        return 0

    # 2. fetch pending + shard across workers
    pending = store.fetch_pending(
        args.max_retries,
        limit=args.limit,
        ignore_retry_budget=retry_existing,
    )
    if not pending:
        LOG.info("没有待处理任务（全部已完成或重试预算耗尽）。")
        stats = store.stats()
        store.finish_run(run_id, status="empty", stats=stats)
        print_summary(stats)
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
            args=(
                chunk,
                store,
                client,
                run_id,
                args.force_ocr,
                args.local_pdf_pages,
                pdf_render_dir,
                args.pdf_render_dpi,
                args.pdf_render_workers,
                args.keep_rendered_pages,
                progress.tick,
            ),
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
    stats = store.stats()
    store.finish_run(run_id, status="completed", jobs_total=len(pending), stats=stats)
    print_summary(stats)
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


def json_dry_run_summary(
    stats: dict[str, int],
    discovered: int,
    col_types: dict[str, str] | None = None,
) -> str:
    import json
    result: dict[str, Any] = {
        "discovered": discovered,
        "jobs_by_status": stats,
    }
    if col_types:
        result["csv_columns"] = col_types
    return json.dumps(result, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    # close() silences “unused import” linters for contextlib helpers in some
    # static analyzers; keeping the symbol referenced.
    with closing(sys.stdin):
        raise SystemExit(main())
