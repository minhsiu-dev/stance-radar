"""Background auto-refresh: discover every N minutes, then analyze if there are pending videos.

When AUTO_REFRESH_MINUTES=0 (default) it doesn't start, behaving exactly like manual mode.
Shares RefreshRunner's single job lock with manual triggers: if it hits an in-progress job, it skips this round.
"""
import asyncio
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.analysis.llm import AnalysisInfrastructureError
from app.models import Job, JobKind, Video, VideoStatus
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

    async def wait(self) -> None:
        """Await the background loop's task; a no-op when auto refresh is disabled
        (the default) and start() never created one. Lets callers race the scheduler's
        task against something else (app/worker.py's _run_until_failure) without
        reaching into the task this class privately tracks."""
        if self._task is not None:
            await self._task

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval_minutes * 60)
            try:
                await self.run_once()
            except AnalysisInfrastructureError:
                # Unlike any other failure here, this one must NOT be swallowed: it means
                # the process that spawns `claude` is broken and needs to exit so Docker
                # can restart it with a clean address space (worker.py is what actually
                # observes this task's outcome and acts on it).
                raise
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
            await self._start_analyze_and_wait()

    async def _start_analyze_and_wait(self) -> None:
        job_id, created = await self._runner.start(JobKind.analyze)
        # Capture current_task right here, with no await in between -- it is
        # guaranteed to correspond to job_id (see _is_analyze_job below for why
        # that correspondence holds even when created=False).
        task = self._runner.current_task
        if created:
            # We just started it ourselves: task is unambiguously the analyze job.
            await self._wait_current(task)
            return
        # created=False means the single global job slot (RefreshRunner allows
        # only one job of ANY kind at a time) was already held by someone else.
        # Often that's the analyze job RefreshRunner auto-started via
        # _continue_if_pending() when our own discover finished with pending
        # videos already queued -- run_once's contract is to wait for that one.
        # But the slot is global, not per-kind: it can just as easily be an
        # unrelated manually-triggered discover or load_older job that grabbed
        # it in this same window. We must NOT block on that -- it can run for a
        # long, unbounded time and has nothing to do with the analyze work we
        # just determined is needed, and run_once would wrongly serialize an
        # auto-refresh cycle behind it. So only wait when the job actually
        # holding the slot is analyze.
        if await self._is_analyze_job(job_id):
            await self._wait_current(task)

    async def _wait_current(self, task: asyncio.Task | None = None) -> None:
        if task is None:
            task = self._runner.current_task
        if task is not None:
            await asyncio.shield(task)

    async def _is_analyze_job(self, job_id: int) -> bool:
        # Look up job_id specifically (not "whatever is running now") so this
        # stays correct even if, by the time this DB round-trip completes, the
        # job has since finished and something else has taken the slot -- we
        # still want the answer for the job `task` above was actually captured
        # for, not a different one.
        async with self._sessionmaker() as session:
            job = await session.get(Job, job_id)
        return job is not None and job.kind == JobKind.analyze.value

    async def _has_pending_videos(self) -> bool:
        async with self._sessionmaker() as session:
            count = (await session.execute(
                select(func.count()).select_from(Video)
                .where(Video.status == VideoStatus.pending)
            )).scalar_one()
        return count > 0
