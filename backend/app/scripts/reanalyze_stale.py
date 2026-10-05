"""Queue videos analyzed before a cutoff (e.g. before a prompt change) for re-analysis.

Run inside the api container:
    python -m app.scripts.reanalyze_stale --before 2026-06-18T00:00:00 [--limit N]

Selects status=analyzed videos with analyzed_at < --before, oldest first, and routes
them back into the pipeline: a stored transcript goes straight to the analysis lane,
none to the transcript lane. The worker lanes do the actual work. Queued videos leave
the `analyzed` set at once, so a re-run only picks up what is still stale; use
--limit to feed the analysis lane in batches.
"""
import argparse
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.db import create_engine_and_sessionmaker
from app.models import Video, VideoStatus
from app.pipeline.queueing import requeue_ids

logger = logging.getLogger(__name__)


async def reanalyze_stale(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    before: datetime,
    limit: int | None,
) -> int:
    """Queue status=analyzed videos with analyzed_at < before, oldest first.
    Returns how many were queued."""
    async with sessionmaker() as session:
        query = (
            select(Video.id)
            .where(
                Video.status == VideoStatus.analyzed,
                Video.analyzed_at < before,
                Video.claimed_at.is_(None),
            )
            .order_by(Video.analyzed_at.asc())
        )
        if limit is not None:
            query = query.limit(limit)
        ids = list((await session.execute(query)).scalars().all())
        await requeue_ids(session, ids)
        await session.commit()
    logger.info(
        "reanalyze_stale: queued %d video(s) analyzed before %s", len(ids), before.isoformat()
    )
    return len(ids)


def _parse_before(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def _main(before: datetime, limit: int | None) -> None:
    settings = get_settings()
    engine, sessionmaker = create_engine_and_sessionmaker(settings.database_url)
    try:
        queued = await reanalyze_stale(sessionmaker, before=before, limit=limit)
        print({"queued": queued})
    finally:
        await engine.dispose()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Queue videos analyzed before a cutoff.")
    parser.add_argument("--before", required=True, help="ISO datetime cutoff (UTC if naive)")
    parser.add_argument("--limit", type=int, default=None, help="max videos to queue this run")
    args = parser.parse_args()
    asyncio.run(_main(_parse_before(args.before), args.limit))


if __name__ == "__main__":
    main()
