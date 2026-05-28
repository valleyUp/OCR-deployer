"""
应用配置管理
"""
from pydantic_settings import BaseSettings
from typing import Literal, Optional
from pathlib import Path


class Settings(BaseSettings):
    """应用配置"""

    # 基础配置
    APP_NAME: str = "OCR Task System"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # 数据库配置
    DATABASE_URL: str = "sqlite+aiosqlite:///./tasks.db"

    # OCR pipeline service URL (container-to-container default)
    LAYOUT_OCR_URL: str = "http://pipeline:5002/glmocr/parse"

    # Formula rendering helpers bundled into the backend image
    FORMULA_RENDERER_SCRIPT: str = "/opt/formula-renderer/render-formula.cjs"
    FORMULA_RENDER_TIMEOUT: int = 20

    # 输出目录
    OUTPUT_DIR: str = "./data"

    # Worker配置
    RUN_WORKERS: bool = True
    WORKER_COUNT: int = 5
    WORKER_POLL_INTERVAL: int = 5  # 秒
    TASK_TIMEOUT: int = 3600  # 秒（1小时）

    # 任务配置
    MAX_QUEUE_SIZE: int = 100
    MAX_CONCURRENT_TASKS: int = 5
    DEFAULT_MAX_RETRIES: int = 3
    DEFAULT_RETRY_DELAY: int = 60  # 秒

    # 清理配置
    CLEANUP_INTERVAL: int = 300  # 秒（5分钟）
    OLD_TASK_DAYS: int = 30  # 天

    # 恢复配置
    RECOVERY_INTERVAL: int = 3600  # 秒（1小时）

    # 监控配置
    METRICS_ENABLED: bool = True
    METRICS_INTERVAL: int = 60  # 秒

    # 日志配置
    LOG_LEVEL: str = "INFO"
    LOG_FILE: Optional[str] = None
    LOG_FORMAT: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    environment: Literal["development", "testing", "production"] = "development"

    # 单任务内版面+OCR 的分页并行度（1 = 顺序，现状；>1 通过 asyncio.Semaphore 限流）
    LAYOUT_PAGE_PARALLELISM: int = 1

    # 前端单文件上传上限（MB），通过 GET /api/v1/config 暴露给 UI
    MAX_UPLOAD_MB: int = 100

    # 匿名设备身份 cookie。只在数据库中保存 token 的 SHA-256 hash。
    OWNER_COOKIE_NAME: str = "ocr_owner_token"
    OWNER_COOKIE_MAX_AGE_DAYS: int = 365
    OWNER_COOKIE_SECURE: bool = False
    PURGE_LEGACY_OWNERLESS_TASKS: bool = True

    class Config:
        env_file = ".env"
        case_sensitive = True

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # 确保输出目录存在
        Path(self.OUTPUT_DIR).mkdir(parents=True, exist_ok=True)


# 创建全局配置实例
settings = Settings()
