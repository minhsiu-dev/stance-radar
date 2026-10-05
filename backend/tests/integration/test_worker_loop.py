"""The worker claims enqueued jobs and runs them; a signal crash ends the process so
Docker can restart it with a clean address space."""
import asyncio
import subprocess
import sys

import pytest
from sqlalchemy import select

import app.worker as worker_module
from app.config import Settings, get_settings
from app.models import Channel, Job, JobStatus, Video, VideoStatus, utcnow
from app.pipeline import jobs
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.worker import JobWorker
from app.youtube.client import FakeYouTubeClient
from tests.conftest import TEST_DATABASE_URL


def _runner(sessionmaker) -> RefreshRunner:
    return RefreshRunner(RefreshDeps(
        sessionmaker=sessionmaker,
        youtube=FakeYouTubeClient(),
        settings=Settings(_env_file=None),
    ))


async def test_poll_once_claims_and_runs_an_enqueued_job(sessionmaker):
    async with sessionmaker() as session:
        await jobs.enqueue_job(session, kind="discover", params=None)

    worker = JobWorker(_runner(sessionmaker), sessionmaker)
    assert await worker.poll_once() is True

    async with sessionmaker() as session:
        row = (await session.execute(select(Job))).scalars().one()
    assert row.status is JobStatus.done
    assert row.claimed_at is not None


async def test_poll_once_is_a_noop_when_nothing_is_enqueued(sessionmaker):
    worker = JobWorker(_runner(sessionmaker), sessionmaker)
    assert await worker.poll_once() is False


async def test_poll_once_closes_a_legacy_analyze_job_as_superseded(sessionmaker):
    """An analyze row can only be a leftover from before the two-lane deploy; running
    it would hold the job slot discover and load_older share."""
    async with sessionmaker() as session:
        await jobs.enqueue_job(session, kind="analyze", params=None)

    assert await JobWorker(_runner(sessionmaker), sessionmaker).poll_once() is True

    async with sessionmaker() as session:
        row = (await session.execute(select(Job))).scalars().one()
    assert row.status is JobStatus.failed
    assert row.error_message == jobs.SUPERSEDED_MESSAGE


async def test_run_forever_sleeps_only_when_idle(monkeypatch):
    """run_forever is a 3-line infinite loop with no coverage of its own before this:
    inverting the `if not` (busy-spin at 100% CPU) or dropping the sleep entirely would
    keep the rest of the suite green. Assert both halves directly: sleep(poll_seconds)
    fires exactly on the "nothing to do" results and never on the "a job just ran" ones.
    """
    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)

    monkeypatch.setattr("app.worker.asyncio.sleep", fake_sleep)

    worker = JobWorker(runner=None, sessionmaker=None, poll_seconds=2.5)
    results = iter([True, False, False, True, False])
    calls = 0

    async def fake_poll_once() -> bool:
        nonlocal calls
        calls += 1
        try:
            return next(results)
        except StopIteration:
            raise RuntimeError("stop the loop") from None

    worker.poll_once = fake_poll_once

    with pytest.raises(RuntimeError, match="stop the loop"):
        await worker.run_forever()

    assert calls == 6
    assert sleep_calls == [2.5, 2.5, 2.5]


async def test_main_cleans_up_orphaned_jobs_before_polling(sessionmaker, monkeypatch):
    """fail_orphan_jobs() must run before the poll loop starts, so a job a previous
    (crashed) worker was still holding gets marked failed rather than sitting claimed
    forever with nobody ever finishing it. run_forever is monkeypatched to fail
    immediately -- right after fail_orphan_jobs would already have run -- so this test
    doesn't have to drive the (otherwise infinite) poll loop to observe the cleanup."""
    monkeypatch.setenv("USE_FAKE_ADAPTERS", "true")
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    get_settings.cache_clear()

    async with sessionmaker() as session:
        orphan = Job(status=JobStatus.running, kind="analyze", claimed_at=utcnow())
        session.add(orphan)
        await session.commit()
        orphan_id = orphan.id

    class StopTheTest(Exception):
        pass

    async def stop_immediately(self) -> None:
        raise StopTheTest()

    monkeypatch.setattr(worker_module.JobWorker, "run_forever", stop_immediately)

    try:
        with pytest.raises(StopTheTest):
            await worker_module.main()

        async with sessionmaker() as session:
            row = await session.get(Job, orphan_id)
        assert row.status is JobStatus.failed
    finally:
        get_settings.cache_clear()


def test_build_worker_adapters_real_path_never_imports_yfinance():
    """The whole point of this module: it must stay safe to import/construct in the
    process that spawns `claude`. Runs in a fresh subprocess rather than asserting
    against this test process's own sys.modules: other tests in this same suite (e.g.
    tests/unit/test_market_client.py) legitimately `import yfinance` for real, so an
    in-process assertion here would pass or fail depending on test collection order
    rather than on what build_worker_adapters() itself actually does.

    The ticker_validator type check closes a hole found in review: fetch_proxy_url=""
    here means YFinanceMarketClient.__init__ (which only imports yfinance `if
    proxy_url:`) wouldn't actually import it either, so copying main.py's
    build_adapters() to wire TickerValidator(YFinanceMarketClient()) in by mistake would
    still pass the 'market' and heavy-imports assertions below undetected -- only
    asserting the adapter is actually HttpTickerValidator catches that regression."""
    script = (
        "import sys\n"
        "from app.config import Settings\n"
        "from app.worker import build_worker_adapters\n"
        "settings = Settings(youtube_api_key='x', use_fake_adapters=False, _env_file=None)\n"
        "adapters = build_worker_adapters(settings)\n"
        "assert 'market' not in adapters, "
        "'build_worker_adapters must not build a market client'\n"
        "assert type(adapters['ticker_validator']).__name__ == 'HttpTickerValidator', "
        "type(adapters['ticker_validator']).__name__\n"
        "heavy = [m for m in sys.modules "
        "if m.split('.')[0] in ('yfinance', 'pandas', 'numpy', 'scipy', 'lxml')]\n"
        "assert not heavy, heavy\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
