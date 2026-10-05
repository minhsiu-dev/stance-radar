import asyncio
import functools
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.models import Channel, JobKind, Video, VideoStatus, utcnow
from app.pipeline import jobs
from app.youtube.client import QuotaExceededError, YouTubeClient

logger = logging.getLogger(__name__)


def _is_short(duration_seconds: int | None, max_seconds: int) -> bool:
    """A video at or under max_seconds (a Short / too-short clip) — skip on import.

    Unknown duration (None, e.g. live/premiere) is never treated as a short.
    """
    return duration_seconds is not None and duration_seconds <= max_seconds


@dataclass
class RefreshDeps:
    sessionmaker: async_sessionmaker[AsyncSession]
    youtube: YouTubeClient
    settings: Settings


class RefreshRunner:
    """Runs the YouTube listing jobs (discover / load_older); only one runs at a time.

    Transcripts and analysis are not jobs: the pipeline lanes (app/pipeline/lanes.py)
    pick queued videos up on their own.
    """

    def __init__(self, deps: RefreshDeps) -> None:
        self._deps = deps
        self._start_lock = asyncio.Lock()
        self.current_task: asyncio.Task | None = None

    async def enqueue(
        self, kind: JobKind = JobKind.discover, channel_id: str | None = None
    ) -> tuple[int, bool]:
        """Create the job row only, unclaimed. Return (job_id, created); created=False
        means one is already running.

        claimed_at is left NULL: nothing is executing this job yet, so a worker's
        claim_next_job() can pick it up later. Contrast with start() below, which runs the
        job in-process right away and so must claim its own row up front.
        """
        async with self._start_lock:
            job_id, created, _params = await self._enqueue_locked(
                kind, channel_id, claimed=False
            )
            return job_id, created

    async def _enqueue_locked(
        self, kind: JobKind, channel_id: str | None, *, claimed: bool
    ) -> tuple[int, bool, dict | None]:
        params = {"channel_id": channel_id} if channel_id else None
        async with self._deps.sessionmaker() as session:
            job, created = await jobs.enqueue_job(
                session, kind=kind.value, params=params, claimed=claimed
            )
            return job.id, created, params

    async def run_job(
        self, job_id: int, kind: JobKind, params: dict | None = None
    ) -> None:
        """Execute an already-created job row to completion."""
        if kind is JobKind.analyze:
            # Analysis runs in the pipeline lanes now. An analyze row can only be a
            # leftover from before the two-lane deploy; close it so it never holds the
            # single job slot discover and load_older share.
            await jobs.finish_job(
                self._deps.sessionmaker, job_id, error=jobs.SUPERSEDED_MESSAGE
            )
            return
        if kind is JobKind.load_older:
            run = functools.partial(
                self._run_load_older, channel_id=(params or {}).get("channel_id")
            )
        else:
            run = self._run_discover
        await self._run_safely(job_id, run)

    async def start(
        self, kind: JobKind = JobKind.discover, channel_id: str | None = None
    ) -> tuple[int, bool]:
        """In-process convenience used by tests and AutoRefreshScheduler: enqueue + run
        in a task.

        _start_lock spans both the enqueue and the create_task: AutoRefreshScheduler.
        run_once reads self.current_task right after calling start(), with no await in
        between, relying on it already being the task for the job start() just created.
        """
        async with self._start_lock:
            job_id, created, params = await self._enqueue_locked(
                kind, channel_id, claimed=True
            )
            if created:
                self.current_task = asyncio.create_task(
                    self.run_job(job_id, kind, params)
                )
        return job_id, created

    async def _run_safely(
        self, job_id: int, run: Callable[[int], Awaitable[None]]
    ) -> None:
        try:
            await run(job_id)
        except QuotaExceededError as exc:
            await jobs.finish_job(self._deps.sessionmaker, job_id, error=str(exc))
            return
        except Exception as exc:
            logger.exception("job %s failed", job_id)
            await jobs.finish_job(
                self._deps.sessionmaker, job_id, error=f"Update failed: {exc}"
            )
            return
        await jobs.finish_job(self._deps.sessionmaker, job_id)

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
            max_seconds = deps.settings.shorts_max_seconds
            added = 0
            for info in new_videos:
                if _is_short(durations.get(info.id), max_seconds):
                    continue
                session.add(Video(
                    id=info.id, channel_id=channel.id, title=info.title,
                    published_at=info.published_at, thumbnail_url=info.thumbnail_url,
                    duration_seconds=durations.get(info.id),
                    status=ingest_status,
                ))
                added += 1
            row = await session.get(Channel, channel.id)
            row.last_refreshed_at = utcnow()
            await session.commit()
            return added

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
            max_seconds = deps.settings.shorts_max_seconds
            added = 0
            for info in older_videos:
                if _is_short(durations.get(info.id), max_seconds):
                    continue
                session.add(Video(
                    id=info.id, channel_id=channel.id, title=info.title,
                    published_at=info.published_at, thumbnail_url=info.thumbnail_url,
                    duration_seconds=durations.get(info.id),
                    status=VideoStatus.skipped,
                ))
                added += 1
            row = await session.get(Channel, channel.id)
            row.last_refreshed_at = utcnow()
            await session.commit()
            return added
