"""The worker claims enqueued jobs and runs them; a signal crash ends the process so
Docker can restart it with a clean address space."""
import asyncio
import subprocess
import sys

import pytest
from sqlalchemy import select

import app.worker as worker_module
from app.analysis.llm import AnalysisInfrastructureError
from app.analysis.tickers import TickerValidator
from app.config import Settings, get_settings
from app.market.client import FakeMarketClient
from app.models import Channel, Job, JobStatus, Video, VideoStatus, utcnow
from app.pipeline import jobs
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.transcripts.client import FakeTranscriptClient
from app.worker import JobWorker
from app.youtube.client import FakeYouTubeClient
from tests.conftest import TEST_DATABASE_URL


def _runner(sessionmaker, llm) -> RefreshRunner:
    return RefreshRunner(RefreshDeps(
        sessionmaker=sessionmaker,
        youtube=FakeYouTubeClient(),
        transcripts=FakeTranscriptClient(),
        llm=llm,
        ticker_validator=TickerValidator(FakeMarketClient()),
        settings=Settings(analysis_concurrency=1),
    ))


class CrashingLLM:
    async def analyze(self, *, video_id, video_title, transcript):
        raise AnalysisInfrastructureError("claude was killed by signal 11")


async def test_poll_once_claims_and_runs_an_enqueued_job(sessionmaker):
    async with sessionmaker() as session:
        await jobs.enqueue_job(session, kind="discover", params=None)

    worker = JobWorker(_runner(sessionmaker, llm=None), sessionmaker)
    assert await worker.poll_once() is True

    async with sessionmaker() as session:
        row = (await session.execute(select(Job))).scalars().one()
    assert row.status is JobStatus.done
    assert row.claimed_at is not None


async def test_poll_once_is_a_noop_when_nothing_is_enqueued(sessionmaker):
    worker = JobWorker(_runner(sessionmaker, llm=None), sessionmaker)
    assert await worker.poll_once() is False


async def test_infrastructure_failure_propagates_so_the_process_can_exit(sessionmaker):
    async with sessionmaker() as session:
        session.add(Channel(
            id="UC1", title="c", thumbnail_url="", uploads_playlist_id="UU1",
        ))
        session.add(Video(
            id="v1", channel_id="UC1", title="t", published_at=utcnow(),
            thumbnail_url="", status=VideoStatus.pending,
            transcript={"language": "en", "segments": [{"start": 0.0, "text": "hi"}]},
        ))
        await session.commit()
        await jobs.enqueue_job(session, kind="analyze", params=None)

    worker = JobWorker(_runner(sessionmaker, CrashingLLM()), sessionmaker)
    with pytest.raises(AnalysisInfrastructureError):
        await worker.poll_once()


async def test_poll_once_propagates_an_infrastructure_failure_from_a_chained_continuation(
    sessionmaker,
):
    """A clean job finish can silently keep the pipeline going: RefreshRunner
    ._continue_if_pending() fires a follow-up job via asyncio.create_task and never
    awaits it itself (run_job() only awaits the job it was given directly). If that
    continuation crashes with AnalysisInfrastructureError, poll_once must still see it --
    otherwise it dies inside a detached task nobody awaits and the worker keeps polling
    in a poisoned address space (found in review: steady state with auto-refresh style
    chaining, discover succeeds, auto-continues into analyze, analyze dies silently,
    repeat).

    The zero-channel-match discover job here is only the trigger for a clean finish that
    _continue_if_pending() reacts to (UU1 matches nothing in FakeYouTubeClient, so
    nothing is actually discovered) -- the pre-seeded pending video below is what makes
    it decide to chain into a crashing analyze job."""
    async with sessionmaker() as session:
        session.add(Channel(
            id="UC1", title="c", thumbnail_url="", uploads_playlist_id="UU1",
        ))
        session.add(Video(
            id="v1", channel_id="UC1", title="t", published_at=utcnow(),
            thumbnail_url="", status=VideoStatus.pending,
            transcript={"language": "en", "segments": [{"start": 0.0, "text": "hi"}]},
        ))
        await session.commit()
        await jobs.enqueue_job(session, kind="discover", params=None)

    worker = JobWorker(_runner(sessionmaker, CrashingLLM()), sessionmaker)
    with pytest.raises(AnalysisInfrastructureError):
        await worker.poll_once()


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


def _crashing_adapters(settings):
    return {
        "youtube": FakeYouTubeClient(),
        "transcripts": FakeTranscriptClient(),
        "llm": CrashingLLM(),
        "ticker_validator": TickerValidator(FakeMarketClient()),
    }


async def test_main_returns_nonzero_when_a_chained_continuation_crashes(
    sessionmaker, monkeypatch
):
    """Process-level proof for the _continue_if_pending bypass (Finding 1's first half):
    with poll_once's draining fix in place, main() must turn an infrastructure failure
    buried in a chained continuation job into exit code 1, not hang forever inside the
    poll loop none the wiser."""
    monkeypatch.setenv("USE_FAKE_ADAPTERS", "true")
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    get_settings.cache_clear()

    async with sessionmaker() as session:
        session.add(Channel(
            id="UC1", title="c", thumbnail_url="", uploads_playlist_id="UU1",
        ))
        session.add(Video(
            id="v1", channel_id="UC1", title="t", published_at=utcnow(),
            thumbnail_url="", status=VideoStatus.pending,
            transcript={"language": "en", "segments": [{"start": 0.0, "text": "hi"}]},
        ))
        await session.commit()
        await jobs.enqueue_job(session, kind="discover", params=None)

    monkeypatch.setattr(worker_module, "build_worker_adapters", _crashing_adapters)

    try:
        result = await asyncio.wait_for(worker_module.main(), timeout=10)
        assert result == 1
    finally:
        get_settings.cache_clear()


async def test_main_returns_nonzero_when_the_scheduler_hits_an_infrastructure_failure(
    sessionmaker, monkeypatch
):
    """Process-level proof for the scheduler bypass (Finding 1's second half): the
    scheduler's own background task (started internally by main() via scheduler.start())
    is a separate asyncio.Task from the worker's poll loop -- see
    app.worker._run_until_failure's docstring for why nothing watched it before this fix.
    AUTO_REFRESH_MINUTES=1 is the smallest value that actually enables the scheduler (0
    means disabled); its real 60s interval is collapsed to instant via a patched
    asyncio.sleep so this stays a fast test while still exercising the real
    AutoRefreshScheduler / _loop() / run_once() chain, including the shielded await
    inside _wait_current -- confirming the exception really does surface through
    asyncio.shield end to end, not just via a mocked run_once()."""
    monkeypatch.setenv("USE_FAKE_ADAPTERS", "true")
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("AUTO_REFRESH_MINUTES", "1")
    get_settings.cache_clear()

    async def instant_sleep(_seconds: float) -> None:
        return

    monkeypatch.setattr("app.pipeline.scheduler.asyncio.sleep", instant_sleep)

    async with sessionmaker() as session:
        session.add(Channel(
            id="UC1", title="c", thumbnail_url="", uploads_playlist_id="UU1",
        ))
        session.add(Video(
            id="v1", channel_id="UC1", title="t", published_at=utcnow(),
            thumbnail_url="", status=VideoStatus.pending,
            transcript={"language": "en", "segments": [{"start": 0.0, "text": "hi"}]},
        ))
        await session.commit()
        # No enqueued job here on purpose: the scheduler's own discover->analyze cycle
        # is what must find and crash on this pending video, not the poll loop.

    monkeypatch.setattr(worker_module, "build_worker_adapters", _crashing_adapters)

    try:
        result = await asyncio.wait_for(worker_module.main(), timeout=10)
        assert result == 1
    finally:
        get_settings.cache_clear()


def test_build_worker_adapters_real_path_never_imports_yfinance():
    """The whole point of this module: it must stay safe to import/construct in the
    process that spawns `claude`. Runs in a fresh subprocess rather than asserting
    against this test process's own sys.modules: other tests in this same suite (e.g.
    tests/unit/test_market_client.py) legitimately `import yfinance` for real, so an
    in-process assertion here would pass or fail depending on test collection order
    rather than on what build_worker_adapters() itself actually does."""
    script = (
        "import sys\n"
        "from app.config import Settings\n"
        "from app.worker import build_worker_adapters\n"
        "settings = Settings(youtube_api_key='x', use_fake_adapters=False, _env_file=None)\n"
        "adapters = build_worker_adapters(settings)\n"
        "assert 'market' not in adapters, "
        "'build_worker_adapters must not build a market client'\n"
        "heavy = [m for m in sys.modules "
        "if m.split('.')[0] in ('yfinance', 'pandas', 'numpy', 'scipy', 'lxml')]\n"
        "assert not heavy, heavy\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
