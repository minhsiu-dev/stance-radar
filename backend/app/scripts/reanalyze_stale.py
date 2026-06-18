"""Resumable re-analyze of videos analyzed before a cutoff (e.g. before a prompt change).

Run inside the api container:
    python -m app.scripts.reanalyze_stale --before 2026-06-18T00:00:00 [--limit N] [--sleep S]

Selects status=analyzed videos with analyzed_at < --before, oldest first, and re-runs the
per-video analysis sequentially. A successful re-analyze advances analyzed_at past the cutoff
(so it leaves the set); a transient failure (rate-limit / IP block) leaves the row untouched so
re-running retries it; a permanent failure (no captions) is marked no_transcript and exits the
set. Re-run until nothing is selected.
"""
import argparse
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.analysis.tickers import TickerValidator
from app.config import get_settings
from app.db import create_engine_and_sessionmaker
from app.main import build_adapters
from app.models import Video, VideoStatus
from app.pipeline.refresh import RefreshDeps, RefreshRunner

logger = logging.getLogger(__name__)


async def reanalyze_stale(
    runner: RefreshRunner, *, before: datetime, limit: int | None, sleep: float
) -> dict:
    """Re-analyze status=analyzed videos with analyzed_at < before, oldest first.

    Returns a tally: {ok, no_transcript, failed, retry_later}.
    """
    deps = runner._deps
    async with deps.sessionmaker() as session:
        query = (
            select(Video.id)
            .where(Video.status == VideoStatus.analyzed, Video.analyzed_at < before)
            .order_by(Video.analyzed_at.asc())
        )
        if limit is not None:
            query = query.limit(limit)
        ids = list((await session.execute(query)).scalars().all())

    counts = {"ok": 0, "no_transcript": 0, "failed": 0, "retry_later": 0}
    total = len(ids)
    logger.info("reanalyze_stale: %d stale video(s) before %s", total, before.isoformat())

    for index, video_id in enumerate(ids, start=1):
        try:
            await runner._process_video(video_id)
        except Exception as exc:  # transient block / unexpected -> leave stale, retry next run
            counts["retry_later"] += 1
            logger.warning("reanalyze %s -> retry-later: %s", video_id, exc)
        else:
            async with deps.sessionmaker() as session:
                video = await session.get(Video, video_id)
                status = video.status
            if status == VideoStatus.analyzed:
                counts["ok"] += 1
            elif status == VideoStatus.no_transcript:
                counts["no_transcript"] += 1
            else:
                counts["failed"] += 1
            logger.info("reanalyze %s -> %s (%d/%d)", video_id, status.value, index, total)
        if sleep and index < total:
            await asyncio.sleep(sleep)

    logger.info("reanalyze_stale done: %s", counts)
    return counts


def _parse_before(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def _main(before: datetime, limit: int | None, sleep: float) -> None:
    settings = get_settings()
    engine, sessionmaker = create_engine_and_sessionmaker(settings.database_url)
    adapters = build_adapters(settings)
    runner = RefreshRunner(RefreshDeps(
        sessionmaker=sessionmaker,
        youtube=adapters["youtube"],
        transcripts=adapters["transcripts"],
        llm=adapters["llm"],
        ticker_validator=TickerValidator(adapters["market"]),
        settings=settings,
    ))
    try:
        counts = await reanalyze_stale(runner, before=before, limit=limit, sleep=sleep)
        print(counts)
    finally:
        await engine.dispose()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Re-analyze videos analyzed before a cutoff.")
    parser.add_argument("--before", required=True, help="ISO datetime cutoff (UTC if naive)")
    parser.add_argument("--limit", type=int, default=None, help="max videos this run")
    parser.add_argument("--sleep", type=float, default=0.0, help="seconds between videos")
    args = parser.parse_args()
    asyncio.run(_main(_parse_before(args.before), args.limit, args.sleep))


if __name__ == "__main__":
    main()
