"""
数据库连接和会话管理
"""
from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.models.base import Base
from app.models.task import Task
from app.services.task_cleanup_service import delete_task_files
from app.utils.config import settings
from app.utils.logger import logger

# 创建异步引擎
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True
)

# 创建异步会话工厂
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)


def _ensure_owner_hash_column(sync_conn) -> None:
    inspector = inspect(sync_conn)
    if "tasks" not in inspector.get_table_names():
        return

    column_names = {column["name"] for column in inspector.get_columns("tasks")}
    if "owner_hash" not in column_names:
        logger.info("Adding tasks.owner_hash column")
        sync_conn.execute(text("ALTER TABLE tasks ADD COLUMN owner_hash VARCHAR(64)"))

    try:
        sync_conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_tasks_owner_hash ON tasks (owner_hash)")
        )
    except Exception as exc:
        logger.warning(f"Failed to ensure owner_hash index: {exc}")


async def purge_ownerless_tasks() -> int:
    if not settings.PURGE_LEGACY_OWNERLESS_TASKS:
        return 0

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Task).where(Task.owner_hash.is_(None)))
        tasks = list(result.scalars().all())
        for task in tasks:
            try:
                delete_task_files(task.task_id, settings.OUTPUT_DIR)
            except Exception as exc:
                logger.warning(
                    f"Failed to delete legacy task files for {task.task_id}: {exc}"
                )
            await session.delete(task)
        await session.commit()

    if tasks:
        logger.info(f"Purged {len(tasks)} legacy ownerless tasks")
    return len(tasks)


async def init_db():
    """初始化数据库"""
    logger.info("Initializing database...")

    # 创建所有表，并对旧 sqlite 数据库补齐 owner_hash 列。
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_ensure_owner_hash_column)

    await purge_ownerless_tasks()

    logger.info("Database initialized successfully")


async def close_db():
    """关闭数据库连接"""
    logger.info("Closing database connection...")
    await engine.dispose()
    logger.info("Database connection closed")


async def get_db() -> AsyncSession:
    """
    获取数据库会话（依赖注入）

    Yields:
        AsyncSession: 数据库会话
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
