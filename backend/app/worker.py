"""Background workers. One image, two roles, two containers:

  python -m app.worker fetch    -> `worker`: discover / load_older jobs, the
                                   auto-refresh scheduler and the transcript lane --
                                   everything that talks to YouTube
  python -m app.worker analyze  -> `worker-analyze`: the analysis lane, the only
                                   process that spawns `claude`

Neither role may import pandas/numpy/OpenBLAS/lxml/yfinance. See
docs/superpowers/specs/2026-08-11-analysis-worker-split-design.md for the SIGSEGV
latch that motivated the first split, and 2026-10-04-two-lane-pipeline-design.md for
why the analysis lane now gets a process of its own: when it exits for a restart,
transcript fetching keeps going.
"""
import asyncio
import logging
import sys
from collections.abc import Coroutine, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.analysis.http_tickers import HttpTickerValidator
from app.analysis.llm import AnalysisInfrastructureError, ClaudeCLIClient, FakeLLMClient
from app.analysis.tickers import TickerValidator
from app.config import Settings, get_settings
from app.db import create_engine_and_sessionmaker
from app.market.client import FakeMarketClient
from app.models import JobKind
from app.net.proxy import ProxyRotator
from app.pipeline import jobs
from app.pipeline.lane_factory import build_analysis_lane, build_transcript_lane
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.pipeline.scheduler import AutoRefreshScheduler
from app.transcripts.client import FakeTranscriptClient, YouTubeTranscriptApiClient
from app.youtube.client import DataAPIYouTubeClient, FakeYouTubeClient

logger = logging.getLogger(__name__)

FETCH = "fetch"
ANALYZE = "analyze"
ROLES = (FETCH, ANALYZE)
USAGE = "usage: python -m app.worker {fetch|analyze}"


def build_worker_adapters(settings: Settings, role: str) -> dict:
    """Like build_adapters() in main.py, but per role and with NO market client:
    ticker validation goes over HTTP to the api, which keeps yfinance (and therefore
    pandas/numpy/OpenBLAS) out of both worker processes."""
    if role == FETCH:
        if settings.use_fake_adapters:
            return {"youtube": FakeYouTubeClient(), "transcripts": FakeTranscriptClient()}
        rotator = ProxyRotator(settings.gluetun_control_url)
        return {
            "youtube": DataAPIYouTubeClient(api_key=settings.youtube_api_key),
            "transcripts": YouTubeTranscriptApiClient(
                proxy_url=settings.fetch_proxy_url, rotator=rotator
            ),
        }
    if settings.use_fake_adapters:
        return {"llm": FakeLLMClient(), "ticker_validator": TickerValidator(FakeMarketClient())}
    return {
        "llm": ClaudeCLIClient(
            binary=settings.claude_bin,
            model=settings.claude_model,
            timeout_seconds=settings.claude_timeout_seconds,
            # No in-process retry: an analysis failure is almost always an exhausted
            # quota, and the lane pauses on the first one instead.
            max_retries=1,
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

    async def poll_once(self) -> bool:
        """Claim and run one job. Returns True if a job was claimed and run here."""
        claimed = await jobs.claim_next_job(self._sessionmaker)
        if claimed is None:
            return False
        job_id, kind, params = claimed
        logger.info("claimed job %s (%s)", job_id, kind)
        await self._runner.run_job(job_id, JobKind(kind), params)
        return True

    async def run_forever(self) -> None:
        while True:
            if not await self.poll_once():
                await asyncio.sleep(self._poll_seconds)


async def _run_until_failure(loops: Sequence[Coroutine[Any, Any, None]]) -> None:
    """Race the role's long-running loops; the first one to raise takes the rest down
    with it. Each runs in its own task, and asyncio never propagates a sibling task's
    exception on its own -- without this a crashed loop would leave the process
    running headless instead of exiting for a restart."""
    tasks = [asyncio.create_task(loop) for loop in loops]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
    for task in done:
        task.result()  # re-raise whichever loop actually failed


async def _run_fetch(
    settings: Settings, sessionmaker: async_sessionmaker[AsyncSession]
) -> None:
    # Only jobs a previous worker was actually holding; enqueued-but-unclaimed work waits.
    cleaned = await jobs.fail_orphan_jobs(sessionmaker)
    if cleaned:
        logger.warning("cleaned up %s orphaned job(s) from a previous run", cleaned)
    adapters = build_worker_adapters(settings, FETCH)
    runner = RefreshRunner(RefreshDeps(
        sessionmaker=sessionmaker, youtube=adapters["youtube"], settings=settings,
    ))
    scheduler = AutoRefreshScheduler(
        runner=runner, interval_minutes=settings.auto_refresh_minutes
    )
    worker = JobWorker(runner, sessionmaker, settings.worker_poll_seconds)
    lane = build_transcript_lane(sessionmaker, adapters["transcripts"], settings)
    scheduler.start()
    try:
        logger.info("fetch worker ready; polling every %ss", settings.worker_poll_seconds)
        await _run_until_failure([worker.run_forever(), scheduler.wait(), lane.run_forever()])
    finally:
        await scheduler.stop()


async def _run_analyze(
    settings: Settings, sessionmaker: async_sessionmaker[AsyncSession]
) -> None:
    adapters = build_worker_adapters(settings, ANALYZE)
    lane = build_analysis_lane(
        sessionmaker, adapters["llm"], adapters["ticker_validator"], settings
    )
    logger.info("analysis worker ready: %s slot(s)", settings.analysis_concurrency)
    await _run_until_failure([lane.run_forever()])


def parse_role(argv: Sequence[str]) -> str | None:
    return argv[0] if len(argv) == 1 and argv[0] in ROLES else None


async def main(argv: Sequence[str] | None = None) -> int:
    role = parse_role(sys.argv[1:] if argv is None else argv)
    if role is None:
        print(USAGE, file=sys.stderr)
        return 2
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    if role == FETCH:
        settings.validate_required_keys(require_claude=False)
    else:
        settings.validate_required_keys(require_youtube=False)
    engine, sessionmaker = create_engine_and_sessionmaker(settings.database_url)
    try:
        if role == FETCH:
            await _run_fetch(settings, sessionmaker)
        else:
            await _run_analyze(settings, sessionmaker)
    except AnalysisInfrastructureError as exc:
        # Exit non-zero so Docker's restart policy gives us a clean address space.
        logger.error("exiting for a restart: %s", exc)
        return 1
    finally:
        await engine.dispose()
    # The loops only ever end by raising. Falling through is unexpected too, and this
    # process's whole contract is "exit non-zero so Docker restarts us".
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
