"""Analysis lane: run the LLM over a stored transcript and persist mentions/stances.

Moved here from the old in-process analyze job in RefreshRunner. The LLM call and ticker validation run
with no session open -- a `claude` call can take five minutes -- and the result is
written in one commit together with status=analyzed and the released claim.
"""
import asyncio
import logging
from datetime import timedelta

from sqlalchemy import delete, func, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.analysis.context import excerpt_around
from app.analysis.llm import AnalysisInfrastructureError, LLMClient, UsageLimitReached
from app.analysis.tickers import TickerValidatorLike
from app.analysis.types import AnalysisResult
from app.models import Mention, Stance, Video, VideoStance, VideoStatus, utcnow
from app.pipeline.stages import NEUTRAL, StageOutcome, failure
from app.transcripts.client import Transcript, transcript_from_json

logger = logging.getLogger(__name__)

# A usage limit that didn't say when it resets: try again after this long
LIMIT_FALLBACK = timedelta(minutes=30)


class AnalysisStage:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        llm: LLMClient,
        ticker_validator: TickerValidatorLike,
    ) -> None:
        self._sessionmaker = sessionmaker
        self.llm = llm
        self.ticker_validator = ticker_validator

    async def process(self, video_id: str) -> StageOutcome:
        started = await self._stamp_attempt(video_id)
        if started is None:
            return NEUTRAL  # deleted with its channel between the claim and now
        title, stored = started
        if stored is None:
            # Only transcribed videos are claimed here and they always carry a
            # transcript; route an anomaly back to the transcript lane instead of
            # pausing this lane over it.
            await self._give_back(video_id, status=VideoStatus.pending)
            return NEUTRAL
        transcript = transcript_from_json(stored)
        try:
            response = await self.llm.analyze(
                video_id=video_id, video_title=title, transcript=transcript
            )
            result = response.result
            valid, dropped = await self._validate(video_id, result)
        except (AnalysisInfrastructureError, asyncio.CancelledError):
            # The process is broken (or shutting down), not the video: give the
            # attempt back and leave it queued for a fresh worker.
            await self._give_back(video_id)
            raise
        except UsageLimitReached as exc:
            # The subscription ran out, not the video: hand it back untouched and let
            # the lane wait for the window to reset.
            await self._give_back(video_id)
            return StageOutcome(
                "limit", error=str(exc), resume_at=exc.resets_at or utcnow() + LIMIT_FALLBACK
            )
        except Exception as exc:  # AnalysisError (incl. timeouts) and anything else
            error = str(exc) or type(exc).__name__
            logger.warning("analysis failed for %s: %s", video_id, error)
            if await self._fail(video_id, error):
                return failure(error)
            return NEUTRAL
        if not await self._persist(video_id, transcript, result, valid, dropped):
            return NEUTRAL
        return StageOutcome("success", usage=response.usage)

    async def _stamp_attempt(self, video_id: str) -> tuple[str, dict | None] | None:
        """Commit the attempt up front, so a crash mid-call still counts."""
        async with self._sessionmaker() as session:
            row = (await session.execute(
                update(Video)
                .where(Video.id == video_id)
                .values(
                    analysis_attempts=Video.analysis_attempts + 1,
                    last_attempt_at=utcnow(),
                )
                .returning(Video.title, Video.transcript)
            )).first()
            await session.commit()
        return None if row is None else (row.title, row.transcript)

    async def _validate(
        self, video_id: str, result: AnalysisResult
    ) -> tuple[set[str], list[str]]:
        tickers = {m.ticker for m in result.mentions} | {s.ticker for s in result.stances}
        valid: set[str] = set()
        dropped: list[str] = []
        for ticker in sorted(tickers):
            if await self.ticker_validator.is_valid(ticker):
                valid.add(ticker)
            else:
                dropped.append(ticker)
                logger.warning("dropping unknown ticker %s from video %s", ticker, video_id)
        return valid, dropped

    async def _persist(
        self,
        video_id: str,
        transcript: Transcript,
        result: AnalysisResult,
        valid: set[str],
        dropped: list[str],
    ) -> bool:
        """Replace the video's mentions/stances and mark it analyzed in one commit.
        Returns False when the video vanished mid-analysis."""
        async with self._sessionmaker() as session:
            video = await session.get(Video, video_id)
            if video is None:
                return False
            # Idempotent: a re-analysis replaces whatever the previous run stored
            await session.execute(delete(Mention).where(Mention.video_id == video_id))
            await session.execute(delete(VideoStance).where(VideoStance.video_id == video_id))
            for m in result.mentions:
                if m.ticker in valid:
                    session.add(Mention(
                        video_id=video_id, ticker=m.ticker,
                        start_seconds=m.start_seconds, quote=m.quote,
                        stance=Stance(m.stance), reasoning=m.reasoning,
                        excerpt=excerpt_around(
                            transcript.segments, start_seconds=m.start_seconds,
                        ),
                        confidence=m.confidence, time_horizon=m.time_horizon,
                        is_conditional=m.is_conditional, condition=m.condition,
                    ))
            for s in result.stances:
                if s.ticker in valid:
                    session.add(VideoStance(
                        video_id=video_id, ticker=s.ticker,
                        stance=Stance(s.stance), summary=s.summary,
                        confidence=s.confidence, is_conditional=s.is_conditional,
                    ))
            video.dropped_tickers = sorted(dropped) or None
            video.tldr = list(result.tldr) if result.tldr else None
            video.transcript_language = transcript.language
            video.status = VideoStatus.analyzed
            video.error_message = None
            video.analyzed_at = utcnow()
            video.claimed_at = None
            await session.commit()
        return True

    async def _fail(self, video_id: str, error: str) -> bool:
        """Mark a video as failed. Returns True if the video was found and updated."""
        async with self._sessionmaker() as session:
            result = await session.execute(
                update(Video)
                .where(Video.id == video_id)
                .values(status=VideoStatus.failed, error_message=error, claimed_at=None)
            )
            await session.commit()
        return result.rowcount > 0

    async def _give_back(self, video_id: str, *, status: VideoStatus | None = None) -> None:
        values = {
            "analysis_attempts": func.greatest(Video.analysis_attempts - 1, 0),
            "claimed_at": None,
        }
        if status is not None:
            values["status"] = status
        async with self._sessionmaker() as session:
            await session.execute(update(Video).where(Video.id == video_id).values(**values))
            await session.commit()
