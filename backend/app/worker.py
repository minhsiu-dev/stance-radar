"""Background job worker.

Runs in its own container so the process that spawns `claude` never imports
pandas/numpy/OpenBLAS/lxml. See docs/superpowers/specs/2026-08-11-analysis-worker-split-design.md
for the incident that motivated the split.
"""
import asyncio
import logging
import sys

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.analysis.http_tickers import HttpTickerValidator
from app.analysis.llm import AnalysisInfrastructureError, ClaudeCLIClient, FakeLLMClient
from app.analysis.tickers import TickerValidator
from app.config import Settings, get_settings
from app.db import create_engine_and_sessionmaker
from app.market.client import FakeMarketClient
from app.models import JobKind
from app.pipeline import jobs
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.pipeline.scheduler import AutoRefreshScheduler
from app.transcripts.client import FakeTranscriptClient, YouTubeTranscriptApiClient
from app.net.proxy import ProxyRotator
from app.youtube.client import DataAPIYouTubeClient, FakeYouTubeClient

logger = logging.getLogger(__name__)


def build_worker_adapters(settings: Settings) -> dict:
    """Like build_adapters() in main.py, but with NO market client.

    Ticker validation goes over HTTP to the api instead, which is what keeps yfinance
    (and therefore pandas/numpy/OpenBLAS) out of this process.
    """
    if settings.use_fake_adapters:
        return {
            "youtube": FakeYouTubeClient(),
            "transcripts": FakeTranscriptClient(),
            "llm": FakeLLMClient(),
            "ticker_validator": TickerValidator(FakeMarketClient()),
        }
    rotator = ProxyRotator(settings.gluetun_control_url)
    return {
        "youtube": DataAPIYouTubeClient(api_key=settings.youtube_api_key),
        "transcripts": YouTubeTranscriptApiClient(
            proxy_url=settings.fetch_proxy_url, rotator=rotator
        ),
        "llm": ClaudeCLIClient(
            binary=settings.claude_bin,
            model=settings.claude_model,
            timeout_seconds=settings.claude_timeout_seconds,
        ),
        "ticker_validator": HttpTickerValidator(settings.api_base_url),
    }


class JobWorker:
    def __init__(
        self,
        runner: RefreshRunner,
        sessionmaker: async_sessionmaker[AsyncSession],
        poll_seconds: float = 1.0,
    ) -> None:
        self._runner = runner
        self._sessionmaker = sessionmaker
        self._poll_seconds = poll_seconds
        self._last_continuation: asyncio.Task | None = None

    async def poll_once(self) -> bool:
        """Claim and run one job (plus any continuation it silently chains into).
        Returns True if a job ran.

        AnalysisInfrastructureError is deliberately NOT caught: the caller exits the
        process so a fresh one takes over.
        """
        claimed = await jobs.claim_next_job(self._sessionmaker)
        if claimed is None:
            return False
        job_id, kind, params = claimed
        logger.info("claimed job %s (%s)", job_id, kind)
        await self._runner.run_job(job_id, JobKind(kind), params)
        await self._drain_continuations()
        return True

    async def _drain_continuations(self) -> None:
        """A clean finish can silently keep the pipeline going: RefreshRunner
        ._continue_if_pending() fires a follow-up job via asyncio.create_task and stores
        it on runner.current_task WITHOUT awaiting it (run_job() above only awaits the
        job it was given directly) -- and that follow-up can itself chain into another
        one the same way. Left alone, an AnalysisInfrastructureError raised inside one of
        those dies as an exception nobody ever retrieves on a detached task instead of
        reaching us: the worker would keep polling inside the very poisoned address space
        it exists to escape (found in review: discover succeeds, auto-continues into
        analyze, analyze dies silently, repeat).

        Adopt and await runner.current_task, following the chain to a fixed point.
        _last_continuation remembers the last task we've already awaited (current_task is
        never reset to None once set, so without this we'd re-await an old, already
        awaited task forever); a genuinely new task -- meaning the chain kept going --
        always compares unequal to it and gets awaited too.
        """
        while True:
            task = self._runner.current_task
            if task is None or task is self._last_continuation:
                return
            self._last_continuation = task
            await task

    async def run_forever(self) -> None:
        while True:
            if not await self.poll_once():
                await asyncio.sleep(self._poll_seconds)


async def _run_until_failure(worker: JobWorker, scheduler: AutoRefreshScheduler) -> None:
    """Run the poll loop, racing it against the scheduler's own background task.

    scheduler.start() (called by main() just before this) drives its discover/analyze
    cycles inside its own asyncio.Task, completely separate from worker.run_forever()'s
    task. Found in review: an AnalysisInfrastructureError raised inside that task (now
    re-raised out of AutoRefreshScheduler._loop() instead of logged-and-swallowed -- see
    the except clause added to scheduler.py) still does not reach main() on its own,
    because asyncio never propagates a sibling task's exception into a coroutine that
    isn't awaiting it; nothing awaited scheduler's task at all before this existed.
    AutoRefreshScheduler exposes no public handle to it, so this reaches into the
    attribute it privately tracks -- when auto refresh is disabled (the default) that
    attribute stays None and only the poll loop is watched, same as before this existed.
    """
    tasks = [asyncio.create_task(worker.run_forever())]
    if scheduler._task is not None:
        tasks.append(scheduler._task)
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
    if pending:
        # Mirrors refresh.py's own sibling-cancellation idiom for an infrastructure
        # abort: don't leave the other loop running headless once we're on our way out.
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
    for task in done:
        task.result()  # re-raise whichever of the two actually failed


async def main() -> int:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    settings.validate_required_keys()
    engine, sessionmaker = create_engine_and_sessionmaker(settings.database_url)
    scheduler: AutoRefreshScheduler | None = None
    try:
        # Only jobs a previous worker was actually holding; enqueued-but-unclaimed work waits.
        cleaned = await jobs.fail_orphan_jobs(sessionmaker)
        if cleaned:
            logger.warning("cleaned up %s orphaned job(s) from a previous run", cleaned)
        adapters = build_worker_adapters(settings)
        runner = RefreshRunner(RefreshDeps(
            sessionmaker=sessionmaker,
            youtube=adapters["youtube"],
            transcripts=adapters["transcripts"],
            llm=adapters["llm"],
            ticker_validator=adapters["ticker_validator"],
            settings=settings,
        ))
        scheduler = AutoRefreshScheduler(
            runner=runner,
            sessionmaker=sessionmaker,
            interval_minutes=settings.auto_refresh_minutes,
        )
        scheduler.start()
        worker = JobWorker(runner, sessionmaker, settings.worker_poll_seconds)
        logger.info("worker ready; polling every %ss", settings.worker_poll_seconds)
        await _run_until_failure(worker, scheduler)
    except AnalysisInfrastructureError as exc:
        # Exit non-zero so Docker's restart policy gives us a clean address space.
        logger.error("exiting for a restart: %s", exc)
        return 1
    finally:
        if scheduler is not None:
            try:
                await scheduler.stop()
            except AnalysisInfrastructureError:
                # scheduler._task (already recorded and turned into return 1 above, or
                # already cancelled by _run_until_failure) is done either way; stop()'s
                # cancel() on a done task is a no-op and its await just re-raises
                # whatever that task finished with. Without this it would silently
                # replace the clean `return 1` above with an uncaught crash instead --
                # same non-zero exit either way, but let's not leave that to chance.
                pass
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
