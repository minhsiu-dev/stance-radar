"""create_all 只建立缺少的 table,不會改既有 type/column;增量變更放這裡。

每條語句必須冪等(IF NOT EXISTS)。在 create_all 之後執行:
全新 DB 由 create_all 建出完整 schema,這裡全部是 no-op;
舊 DB 則由這裡補上新 enum 值與欄位。
"""
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger(__name__)

_STATEMENTS = (
    # Postgres 不允許在交易內 ALTER TYPE ... ADD VALUE → 走 AUTOCOMMIT
    "ALTER TYPE video_status ADD VALUE IF NOT EXISTS 'discovered'",
    "ALTER TYPE video_status ADD VALUE IF NOT EXISTS 'skipped'",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kind"
    " VARCHAR(16) NOT NULL DEFAULT 'discover'",
)


async def run_startup_migrations(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        autocommit = await conn.execution_options(isolation_level="AUTOCOMMIT")
        for statement in _STATEMENTS:
            logger.debug("startup migration: %s", statement)
            await autocommit.execute(text(statement))
