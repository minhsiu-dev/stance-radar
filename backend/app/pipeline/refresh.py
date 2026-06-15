import asyncio
import functools
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.analysis.context import excerpt_around
from app.analysis.llm import AnalysisError, LLMClient
from app.analysis.tickers import TickerValidator
from app.config import Settings
from app.models import (
    Channel, JobKind, Mention, Stance, Video, VideoStance, VideoStatus, utcnow,
)
from app.pipeline import jobs
from app.transcripts.client import TranscriptClient, TranscriptNotAvailable
from app.youtube.client import QuotaExceededError, YouTubeClient

logger = logging.getLogger(__name__)


@dataclass
class RefreshDeps:
    sessionmaker: async_sessionmaker[AsyncSession]
    youtube: YouTubeClient
    transcripts: TranscriptClient
    llm: LLMClient
    ticker_validator: TickerValidator
    settings: Settings


class RefreshRunner:
    """Only one refresh job is allowed at a time. start() launches the background task and returns immediately."""

    def __init__(self, deps: RefreshDeps) -> None:
        self._deps = deps
        self._start_lock = asyncio.Lock()
        self.current_task: asyncio.Task | None = None

    async def start(
        self, kind: JobKind = JobKind.discover, channel_id: str | None = None
    ) -> tuple[int, bool]:
        """Return (job_id, created). created=False means a job is already running."""
        async with self._start_lock:
            async with self._deps.sessionmaker() as session:
                job, created = await jobs.start_job(session, kind=kind.value)
                job_id = job.id
            if created:
                if kind is JobKind.discover:
                    run = self._run_discover
                elif kind is JobKind.load_older:
                    run = functools.partial(
                        self._run_load_older, channel_id=channel_id
                    )
                else:
                    run = self._run_analyze
                self.current_task = asyncio.create_task(
                    self._run_safely(job_id, run)
                )
        return job_id, created

    async def _run_safely(
        self, job_id: int, run: Callable[[int], Awaitable[None]]
    ) -> None:
        try:
            await run(job_id)
            await jobs.finish_job(self._deps.sessionmaker, job_id)
        except QuotaExceededError as exc:
            await jobs.finish_job(self._deps.sessionmaker, job_id, error=str(exc))
        except Exception as exc:
            logger.exception("job %s failed", job_id)
            await jobs.finish_job(
                self._deps.sessionmaker, job_id, error=f"Update failed: {exc}"
            )

    async def _run_discover(self, job_id: int) -> None:
        deps = self._deps
        async with deps.sessionmaker() as session:
            channels = list((await session.execute(select(Channel))).scalars().all())

        total_channels = len(channels)
        discovered = 0
        for i, channel in enumerate(channels):
            await jobs.update_progress(deps.sessionmaker, job_id, {
                "stage": "listing",
                "channels_done": i, "channels_total": total_channels,
                "discovered": discovered,
            })
            discovered += await self._ingest_channel_videos(channel)
        await jobs.update_progress(deps.sessionmaker, job_id, {
            "stage": "listing",
            "channels_done": total_channels, "channels_total": total_channels,
            "discovered": discovered,
        })

    async def _run_analyze(self, job_id: int) -> None:
        deps = self._deps
        # Pick up all pending: both the ones selected this round and leftovers from a prior interruption (resume semantics)
        async with deps.sessionmaker() as session:
            pending = list((await session.execute(
                select(Video.id)
                .where(Video.status == VideoStatus.pending)
                .order_by(Video.published_at.desc())
            )).scalars().all())

        total = len(pending)
        await jobs.update_progress(deps.sessionmaker, job_id, {
            "stage": "analyzing", "videos_done": 0, "videos_total": total,
        })
        done = 0
        progress_lock = asyncio.Lock()
        semaphore = asyncio.Semaphore(deps.settings.analysis_concurrency)

        async def process(video_id: str) -> None:
            nonlocal done
            async with semaphore:
                try:
                    await self._process_video(video_id)
                except Exception as exc:  # one video failing shouldn't take down the whole job
                    logger.exception("video %s processing failed", video_id)
                    await self._mark_video_failed(video_id, str(exc))
            async with progress_lock:
                done += 1
                await jobs.update_progress(deps.sessionmaker, job_id, {
                    "stage": "analyzing", "videos_done": done, "videos_total": total,
                })

        await asyncio.gather(*(process(video_id) for video_id in pending))

    async def _ingest_channel_videos(self, channel: Channel) -> int:
        """Ingest the channel's new videos (status=discovered); returns the number added.

        When the channel has auto_analyze enabled, "subsequently published" videos go straight to pending;
        the initial backfill (known_ids empty) still goes to discovered for the user to select.
        """
        deps = self._deps
        async with deps.sessionmaker() as session:
            known_ids = set((await session.execute(
                select(Video.id).where(Video.channel_id == channel.id)
            )).scalars().all())
            is_backfill = not known_ids
            limit = deps.settings.backfill_limit if is_backfill else None
            new_videos = await deps.youtube.list_new_uploads(
                channel.uploads_playlist_id, known_video_ids=known_ids, limit=limit
            )
            durations = (
                await deps.youtube.get_durations([v.id for v in new_videos])
                if new_videos else {}
            )
            ingest_status = (
                VideoStatus.pending
                if channel.auto_analyze and not is_backfill
                else VideoStatus.discovered
            )
            for info in new_videos:
                session.add(Video(
                    id=info.id, channel_id=channel.id, title=info.title,
                    published_at=info.published_at, thumbnail_url=info.thumbnail_url,
                    duration_seconds=durations.get(info.id),
                    status=ingest_status,
                ))
            row = await session.get(Channel, channel.id)
            row.last_refreshed_at = utcnow()
            await session.commit()
            return len(new_videos)

    async def _run_load_older(self, job_id: int, *, channel_id: str) -> None:
        """Load older videos for a single channel (walking past the known block); all go to skipped."""
        deps = self._deps
        async with deps.sessionmaker() as session:
            channel = await session.get(Channel, channel_id)
        if channel is None:
            await jobs.update_progress(deps.sessionmaker, job_id, {
                "stage": "listing",
                "channels_done": 1, "channels_total": 1, "discovered": 0,
            })
            return
        discovered = await self._ingest_older_channel_videos(channel)
        await jobs.update_progress(deps.sessionmaker, job_id, {
            "stage": "listing",
            "channels_done": 1, "channels_total": 1, "discovered": discovered,
        })

    async def _ingest_older_channel_videos(self, channel: Channel) -> int:
        """Load the channel's older unknown videos, all with status=skipped; returns the number added.

        Older videos are the range the user manually digs back into: by default they don't need review and go
        straight to skipped (not discovered-for-selection, and not auto_analyze). If the user wants to analyze
        one, they can still press "Analyze" on an individual skipped video on the channel page.
        """
        deps = self._deps
        async with deps.sessionmaker() as session:
            known_ids = set((await session.execute(
                select(Video.id).where(Video.channel_id == channel.id)
            )).scalars().all())
            older_videos = await deps.youtube.list_older_uploads(
                channel.uploads_playlist_id,
                known_video_ids=known_ids,
                limit=deps.settings.backfill_limit,
            )
            durations = (
                await deps.youtube.get_durations([v.id for v in older_videos])
                if older_videos else {}
            )
            for info in older_videos:
                session.add(Video(
                    id=info.id, channel_id=channel.id, title=info.title,
                    published_at=info.published_at, thumbnail_url=info.thumbnail_url,
                    duration_seconds=durations.get(info.id),
                    status=VideoStatus.skipped,
                ))
            row = await session.get(Channel, channel.id)
            row.last_refreshed_at = utcnow()
            await session.commit()
            return len(older_videos)

    async def _process_video(self, video_id: str) -> None:
        deps = self._deps
        async with deps.sessionmaker() as session:
            video = await session.get(Video, video_id)
            try:
                transcript = await deps.transcripts.fetch(video_id)
            except TranscriptNotAvailable:
                video.status = VideoStatus.no_transcript
                video.error_message = None
                await session.commit()
                return
            try:
                result = await deps.llm.analyze(
                    video_id=video_id, video_title=video.title, transcript=transcript
                )
            except AnalysisError as exc:
                video.status = VideoStatus.failed
                video.error_message = str(exc)
                await session.commit()
                return

            # Idempotent: when reprocessing a failed video, clear leftover data first
            await session.execute(delete(Mention).where(Mention.video_id == video_id))
            await session.execute(
                delete(VideoStance).where(VideoStance.video_id == video_id)
            )
            tickers = {m.ticker for m in result.mentions} | {
                s.ticker for s in result.stances
            }
            valid: set[str] = set()
            dropped: list[str] = []
            for ticker in tickers:
                if await deps.ticker_validator.is_valid(ticker):
                    valid.add(ticker)
                else:
                    dropped.append(ticker)
                    logger.warning(
                        "dropping unknown ticker %s from video %s", ticker, video_id
                    )
            for m in result.mentions:
                if m.ticker in valid:
                    excerpt = excerpt_around(
                        transcript.segments, start_seconds=m.start_seconds,
                    )
                    session.add(Mention(
                        video_id=video_id, ticker=m.ticker,
                        start_seconds=m.start_seconds, quote=m.quote,
                        stance=Stance(m.stance), reasoning=m.reasoning,
                        excerpt=excerpt,
                        confidence=m.confidence, time_horizon=m.time_horizon,
                        is_conditional=m.is_conditional, condition=m.condition,
                    ))
            for s in result.stances:
                if s.ticker in valid:
                    session.add(VideoStance(
                        video_id=video_id, ticker=s.ticker,
                        stance=Stance(s.stance), summary=s.summary,
                        confidence=s.confidence,
                    ))
            video.dropped_tickers = sorted(dropped) or None
            video.transcript_language = transcript.language
            video.status = VideoStatus.analyzed
            video.error_message = None
            video.analyzed_at = utcnow()
            await session.commit()

    async def _mark_video_failed(self, video_id: str, error: str) -> None:
        async with self._deps.sessionmaker() as session:
            video = await session.get(Video, video_id)
            if video is not None:
                video.status = VideoStatus.failed
                video.error_message = error
                await session.commit()
