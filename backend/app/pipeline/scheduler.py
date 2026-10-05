"""Background auto-refresh: run discover every N minutes.

When AUTO_REFRESH_MINUTES=0 (default) it doesn't start, behaving exactly like manual
mode. Shares RefreshRunner's single job slot with manual triggers: if it hits an
in-progress job, it skips this round. Videos the discover queues (auto_analyze
channels) are picked up by the pipeline lanes on their own; the scheduler never
starts analysis.
"""
import asyncio
import logging

from app.models import JobKind
from app.pipeline.refresh import RefreshRunner

logger = logging.getLogger(__name__)


class AutoRefreshScheduler:
    def __init__(self, runner: RefreshRunner, interval_minutes: int) -> None:
        self._runner = runner
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
        (the default) and start() never created one. Lets app/worker.py race the
        scheduler against the other loops without reaching into this task."""
        if self._task is not None:
            await self._task

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval_minutes * 60)
            try:
                await self.run_once()
            except Exception:  # a single failed round shouldn't stop the scheduler
                logger.exception("auto refresh cycle failed")

    async def run_once(self) -> None:
        _, created = await self._runner.start(JobKind.discover)
        if not created:
            logger.info("auto refresh skipped: another job is running")
            return
        # start() sets current_task before releasing its lock: this is our discover
        task = self._runner.current_task
        if task is not None:
            await asyncio.shield(task)
