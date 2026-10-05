"""Where a video goes when it is (re-)entered into the two-lane pipeline.

A video with a stored transcript skips straight to the analysis lane -- re-analysis
runs offline, never touching YouTube; one without goes to the transcript lane first.
Every path that queues work uses this: picking videos, retrying failures,
re-analysing, and the reanalyze_stale script.
"""
from collections.abc import Sequence

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Video, VideoStatus


def queue_status_for(has_transcript: bool) -> VideoStatus:
    return VideoStatus.transcribed if has_transcript else VideoStatus.pending


async def requeue_ids(session: AsyncSession, ids: Sequence[str]) -> None:
    """Route videos back into the pipeline by id without loading transcript JSONB
    into memory (a retry batch can be hundreds of videos). Caller commits."""
    if not ids:
        return
    for has_transcript in (False, True):
        has = Video.transcript.is_not(None) if has_transcript else Video.transcript.is_(None)
        await session.execute(
            update(Video)
            .where(Video.id.in_(ids), has)
            .values(status=queue_status_for(has_transcript), error_message=None)
        )
