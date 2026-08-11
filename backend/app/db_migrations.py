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
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS tldr JSONB",
    "ALTER TABLE mentions ADD COLUMN IF NOT EXISTS confidence VARCHAR(8)",
    "ALTER TABLE mentions ADD COLUMN IF NOT EXISTS time_horizon VARCHAR(16)",
    "ALTER TABLE mentions ADD COLUMN IF NOT EXISTS is_conditional BOOLEAN",
    "ALTER TABLE mentions ADD COLUMN IF NOT EXISTS condition TEXT",
    "ALTER TABLE mentions ADD COLUMN IF NOT EXISTS excerpt TEXT",
    "ALTER TABLE video_stances ADD COLUMN IF NOT EXISTS confidence VARCHAR(8)",
    "ALTER TABLE video_stances ADD COLUMN IF NOT EXISTS is_conditional BOOLEAN",
    # Backfill overall-stance conditionality from mentions so already-analyzed conditional
    # calls (e.g. an exit-plan sell) are corrected without re-analysis. Idempotent: only
    # fills NULLs; sets TRUE when every matching-stance mention for the (video, ticker) is conditional.
    "UPDATE video_stances vs SET is_conditional = TRUE"
    " WHERE vs.is_conditional IS NULL"
    "   AND EXISTS (SELECT 1 FROM mentions m"
    "               WHERE m.video_id = vs.video_id AND m.ticker = vs.ticker"
    "                 AND m.stance = vs.stance AND m.is_conditional IS TRUE)"
    "   AND NOT EXISTS (SELECT 1 FROM mentions m"
    "               WHERE m.video_id = vs.video_id AND m.ticker = vs.ticker"
    "                 AND m.stance = vs.stance AND m.is_conditional IS NOT TRUE)",
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_attempts"
    " INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ",
    # Backfill: a video carrying an error_message has been attempted at least once, so
    # showing "0 attempts" would lie. Idempotent by construction — after this runs the
    # touched rows hold 1, so a second pass matches nothing, and it can never clobber a
    # real count. Videos that were never analyzed have error_message NULL and stay 0.
    "UPDATE videos SET analysis_attempts = 1"
    " WHERE analysis_attempts = 0 AND error_message IS NOT NULL",
    # Portfolio feature removed: drop its tables + enum (no-op on fresh DBs)
    "DROP TABLE IF EXISTS portfolio_transactions",
    "DROP TABLE IF EXISTS portfolio_cash",
    "DROP TYPE IF EXISTS transaction_side",
    # Worker split: a worker process claims a job row the api enqueued.
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS params JSONB",
)


async def run_startup_migrations(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        autocommit = await conn.execution_options(isolation_level="AUTOCOMMIT")
        for statement in _STATEMENTS:
            logger.debug("startup migration: %s", statement)
            await autocommit.execute(text(statement))
