"""Background auto-refresh: discover every N minutes, then analyze if there are pending videos.

When AUTO_REFRESH_MINUTES=0 (default) it doesn't start, behaving exactly like manual mode.
Shares RefreshRunner's single job lock with manual triggers: if it hits an in-progress job, it skips this round.
"""
import asyncio
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import JobKind, Video, VideoStatus
from app.pipeline.refresh import RefreshRunner

logger = logging.getLogger(__name__)


class AutoRefreshScheduler:
    def __init__(
        self,
        runner: RefreshRunner,
        sessionmaker: async_sessionmaker[AsyncSession],
        interval_minutes: int,
    ) -> None:
        self._runner = runner
        self._sessionmaker = sessionmaker
        self._interval_minutes = interval_minutes
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._interval_minutes <= 0 or self._task is not None:
            return
        self._task = asyncio.create_task(self._loop())
        logger.info("auto refresh enabled: every %s minutes", self._interval_minutes)

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval_minutes * 60)
            try:
                await self.run_once()
            except Exception:  # a single failed round shouldn't stop the scheduler
                logger.exception("auto refresh cycle failed")

    async def run_once(self) -> None:
        """discover -> (if pending) analyze. Waits for each job to actually finish between steps."""
        _, created = await self._runner.start(JobKind.discover)
        if not created:
            logger.info("auto refresh skipped: another job is running")
            return
        await self._wait_current()
        if await self._has_pending_videos():
            # created=False here does NOT mean "nothing to wait for": RefreshRunner
            # auto-starts an analyze job via _continue_if_pending() when a discover
            # finishes with pending videos, so the job is already running and the DB
            # single-job guard refuses to start a second one. Either way an analyze job
            # is in flight, and run_once's contract is to wait for it to finish.
            await self._runner.start(JobKind.analyze)
            await self._wait_current()

    async def _wait_current(self) -> None:
        task = self._runner.current_task
        if task is not None:
            await asyncio.shield(task)

    async def _has_pending_videos(self) -> bool:
        async with self._sessionmaker() as session:
            count = (await session.execute(
                select(func.count()).select_from(Video)
                .where(Video.status == VideoStatus.pending)
            )).scalar_one()
        return count > 0
