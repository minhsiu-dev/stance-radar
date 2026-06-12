"""One-off backfill: recompute mention context with the segment-accumulation logic.

Usage:
    DATABASE_URL=postgresql+asyncpg://stance:stance@localhost:5432/stance_radar \
        .venv/bin/python scripts/backfill_context.py
"""
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.analysis.context import surrounding_segments
from app.models import Mention
from app.transcripts.client import TranscriptNotAvailable, YouTubeTranscriptApiClient

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("backfill_context")

DEFAULT_DB = "postgresql+asyncpg://stance:stance@localhost:5432/stance_radar"


async def main() -> None:
    engine = create_async_engine(os.environ.get("DATABASE_URL", DEFAULT_DB))
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    client = YouTubeTranscriptApiClient()

    async with sessionmaker() as session:
        mentions = list((await session.execute(select(Mention))).scalars().all())
    by_video: dict[str, list[Mention]] = {}
    for m in mentions:
        by_video.setdefault(m.video_id, []).append(m)
    logger.info("%d mentions across %d videos", len(mentions), len(by_video))

    updated = skipped = 0
    for video_id, video_mentions in by_video.items():
        try:
            transcript = await client.fetch(video_id)
        except TranscriptNotAvailable:
            logger.warning("skip %s: transcript not available", video_id)
            skipped += 1
            continue
        except Exception as exc:  # 單部失敗不中斷整個 backfill
            logger.warning("skip %s: %s", video_id, exc)
            skipped += 1
            continue
        async with sessionmaker() as session:
            for m in video_mentions:
                before, after = surrounding_segments(
                    transcript.segments,
                    start_seconds=m.start_seconds,
                    quote=m.quote,
                )
                row = await session.get(Mention, m.id)
                row.context_before = before
                row.context_after = after
            await session.commit()
        updated += 1
        logger.info("updated %s (%d mentions)", video_id, len(video_mentions))
        await asyncio.sleep(0.5)  # 避免打太快被 YouTube rate limit

    logger.info("done: %d videos updated, %d skipped", updated, skipped)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
