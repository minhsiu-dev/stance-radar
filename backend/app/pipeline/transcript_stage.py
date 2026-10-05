"""Transcript lane: fetch a pending video's captions and store them.

The transcript is written in the same commit that moves the video to `transcribed`,
so a `failed` video with a NULL transcript always means "died fetching" -- the rule
/api/videos/failures classifies by. (Before the lanes, the transcript only reached
the DB together with the analysis result, and an unrelated crash after a successful
fetch rolled it back and misfiled the video as a transcript failure.)
"""
import asyncio
import logging

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Video, VideoStatus, utcnow
from app.pipeline.stages import NEUTRAL, SUCCESS, StageOutcome, failure
from app.transcripts.client import (
    TranscriptClient,
    TranscriptNotAvailable,
    transcript_to_json,
)

logger = logging.getLogger(__name__)


class TranscriptStage:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        client: TranscriptClient,
    ) -> None:
        self._sessionmaker = sessionmaker
        self.client = client

    async def process(self, video_id: str) -> StageOutcome:
        if not await self._stamp_attempt(video_id):
            return NEUTRAL  # deleted with its channel between the claim and now
        try:
            transcript = await self.client.fetch(video_id)
        except TranscriptNotAvailable:
            # Captions off / video gone: permanent, and nobody's fault
            await self._write(video_id, status=VideoStatus.no_transcript, error_message=None)
            return NEUTRAL
        except asyncio.CancelledError:
            await self._give_back(video_id)
            raise
        except Exception as exc:  # IpBlocked / RequestBlocked land here: retryable
            error = str(exc) or type(exc).__name__
            logger.warning("transcript fetch failed for %s: %s", video_id, error)
            await self._write(video_id, status=VideoStatus.failed, error_message=error)
            return failure(error)
        await self._write(
            video_id,
            status=VideoStatus.transcribed,
            error_message=None,
            transcript=transcript_to_json(transcript),
            transcript_language=transcript.language,
        )
        return SUCCESS

    async def _stamp_attempt(self, video_id: str) -> bool:
        """Commit the attempt before fetching, so a crash mid-fetch still counts."""
        async with self._sessionmaker() as session:
            result = await session.execute(
                update(Video)
                .where(Video.id == video_id)
                .values(
                    transcript_attempts=Video.transcript_attempts + 1,
                    last_attempt_at=utcnow(),
                )
            )
            await session.commit()
        return result.rowcount > 0

    async def _write(self, video_id: str, **values: object) -> None:
        async with self._sessionmaker() as session:
            await session.execute(
                update(Video).where(Video.id == video_id).values(claimed_at=None, **values)
            )
            await session.commit()

    async def _give_back(self, video_id: str) -> None:
        """Cancelled mid-fetch (shutdown): this attempt never really happened."""
        async with self._sessionmaker() as session:
            await session.execute(
                update(Video)
                .where(Video.id == video_id)
                .values(
                    transcript_attempts=func.greatest(Video.transcript_attempts - 1, 0),
                    claimed_at=None,
                )
            )
            await session.commit()
