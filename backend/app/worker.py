"""Background job worker.

Runs in its own container so the process that spawns `claude` never imports
pandas/numpy/OpenBLAS/lxml. See docs/superpowers/specs/2026-08-11-analysis-worker-split-design.md
for the incident that motivated the split.
"""
import asyncio
import logging
import sys

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import models  # noqa: F401  # register models for create_all
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

    async def poll_once(self) -> bool:
        """Claim and run one job. Returns True if a job ran.

        AnalysisInfrastructureError is deliberately NOT caught: the caller exits the
        process so a fresh one takes over.
        """
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
        await worker.run_forever()
    except AnalysisInfrastructureError as exc:
        # Exit non-zero so Docker's restart policy gives us a clean address space.
        logger.error("exiting for a restart: %s", exc)
        return 1
    finally:
        if scheduler is not None:
            await scheduler.stop()
        await engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
