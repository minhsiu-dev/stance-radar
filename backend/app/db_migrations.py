"""create_all only creates missing tables; it won't alter existing types/columns. Incremental changes go here.

Each statement must be idempotent (IF NOT EXISTS). Runs after create_all:
on a brand-new DB, create_all builds the full schema and everything here is a no-op;
on an old DB, this is what backfills new enum values and columns.
"""
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger(__name__)

_STATEMENTS = (
    # Postgres doesn't allow ALTER TYPE ... ADD VALUE inside a transaction -> use AUTOCOMMIT
    "ALTER TYPE video_status ADD VALUE IF NOT EXISTS 'discovered'",
    "ALTER TYPE video_status ADD VALUE IF NOT EXISTS 'skipped'",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kind"
    " VARCHAR(16) NOT NULL DEFAULT 'discover'",
    "ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_analyze"
    " BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS dropped_tickers JSONB",
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript JSONB",
    "ALTER TABLE mentions ADD COLUMN IF NOT EXISTS confidence VARCHAR(8)",
    "ALTER TABLE mentions ADD COLUMN IF NOT EXISTS time_horizon VARCHAR(16)",
    "ALTER TABLE mentions ADD COLUMN IF NOT EXISTS is_conditional BOOLEAN",
    "ALTER TABLE mentions ADD COLUMN IF NOT EXISTS condition TEXT",
    "ALTER TABLE mentions ADD COLUMN IF NOT EXISTS excerpt TEXT",
    "ALTER TABLE video_stances ADD COLUMN IF NOT EXISTS confidence VARCHAR(8)",
    # Portfolio feature removed: drop its tables + enum (no-op on fresh DBs)
    "DROP TABLE IF EXISTS portfolio_transactions",
    "DROP TABLE IF EXISTS portfolio_cash",
    "DROP TYPE IF EXISTS transaction_side",
)


async def run_startup_migrations(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        autocommit = await conn.execution_options(isolation_level="AUTOCOMMIT")
        for statement in _STATEMENTS:
            logger.debug("startup migration: %s", statement)
            await autocommit.execute(text(statement))
