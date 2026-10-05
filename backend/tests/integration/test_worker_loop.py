"""The workers: `fetch` claims enqueued jobs and runs the transcript lane; `analyze`
runs the analysis lane, and a signal crash there ends the process so Docker can
restart it with a clean address space."""
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
from app.models import (
    ANALYSIS_LANE, Channel, Job, JobStatus, PipelineLane, Video, VideoStatus, utcnow,
)
from app.pipeline import jobs
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.worker import JobWorker
from app.youtube.client import FakeYouTubeClient
from tests.conftest import TEST_DATABASE_URL

STORED = {"language": "en", "segments": [{"start": 0.0, "text": "hi"}]}


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
            await worker_module.main([worker_module.FETCH])

        async with sessionmaker() as session:
            row = await session.get(Job, orphan_id)
        assert row.status is JobStatus.failed
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize(
    "role, expected",
    [("fetch", {"youtube", "transcripts"}), ("analyze", {"llm", "ticker_validator"})],
)
def test_build_worker_adapters_real_path_never_imports_yfinance(role, expected):
    """Both roles must stay safe to import/construct in a process that must never load
    pandas/numpy/OpenBLAS. Runs in a fresh subprocess rather than asserting against
    this test process's own sys.modules: other tests in this suite legitimately import
    yfinance, so an in-process check would depend on collection order.

    The HttpTickerValidator check closes a hole found in review: fetch_proxy_url=""
    means YFinanceMarketClient wouldn't import yfinance either, so wiring
    TickerValidator(YFinanceMarketClient()) in by mistake would otherwise go unnoticed."""
    script = (
        "import sys\n"
        "from app.config import Settings\n"
        "from app.worker import build_worker_adapters\n"
        "settings = Settings(youtube_api_key='x', use_fake_adapters=False, _env_file=None)\n"
        f"adapters = build_worker_adapters(settings, {role!r})\n"
        f"assert set(adapters) == {expected!r}, set(adapters)\n"
        "if 'ticker_validator' in adapters:\n"
        "    name = type(adapters['ticker_validator']).__name__\n"
        "    assert name == 'HttpTickerValidator', name\n"
        "heavy = [m for m in sys.modules "
        "if m.split('.')[0] in ('yfinance', 'pandas', 'numpy', 'scipy', 'lxml')]\n"
        "assert not heavy, heavy\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_parse_role_accepts_exactly_one_known_role():
    assert worker_module.parse_role(["fetch"]) == "fetch"
    assert worker_module.parse_role(["analyze"]) == "analyze"
    for argv in ([], ["bogus"], ["fetch", "analyze"]):
        assert worker_module.parse_role(argv) is None


async def test_main_without_a_role_prints_usage_and_exits_2(capsys):
    assert await worker_module.main([]) == 2
    assert "usage" in capsys.readouterr().err


def _fake_env(monkeypatch) -> None:
    monkeypatch.setenv("USE_FAKE_ADAPTERS", "true")
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("WORKER_POLL_SECONDS", "0.01")
    get_settings.cache_clear()


async def test_fetch_role_runs_the_transcript_lane(sessionmaker, monkeypatch):
    _fake_env(monkeypatch)
    async with sessionmaker() as s:
        s.add(Channel(id="UC_fake_alpha", title="a", thumbnail_url="", uploads_playlist_id="UU1"))
        s.add(Video(
            id="alpha_vid_3", channel_id="UC_fake_alpha", title="t", published_at=utcnow(),
            thumbnail_url="", status=VideoStatus.pending,
        ))
        await s.commit()

    class StopTheTest(Exception):
        pass

    async def stop_once_transcribed(self) -> None:
        for _ in range(250):
            async with sessionmaker() as s:
                if (await s.get(Video, "alpha_vid_3")).status is VideoStatus.transcribed:
                    raise StopTheTest()
            await asyncio.sleep(0.02)
        raise AssertionError("the transcript lane never picked the video up")

    monkeypatch.setattr(worker_module.JobWorker, "run_forever", stop_once_transcribed)
    try:
        with pytest.raises(StopTheTest):
            await worker_module.main([worker_module.FETCH])
    finally:
        get_settings.cache_clear()


async def test_analyze_role_exits_nonzero_when_claude_dies_by_signal(sessionmaker, monkeypatch):
    _fake_env(monkeypatch)
    async with sessionmaker() as s:
        s.add(Channel(id="UC1", title="c", thumbnail_url="", uploads_playlist_id="UU1"))
        s.add(Video(
            id="v1", channel_id="UC1", title="t", published_at=utcnow(),
            thumbnail_url="", status=VideoStatus.transcribed, transcript=STORED,
        ))
        await s.commit()

    class CrashingLLM:
        async def analyze(self, *, video_id, video_title, transcript):
            raise AnalysisInfrastructureError("claude was killed by signal 11")

    def crashing_adapters(settings, role):
        assert role == worker_module.ANALYZE
        return {"llm": CrashingLLM(), "ticker_validator": TickerValidator(FakeMarketClient())}

    monkeypatch.setattr(worker_module, "build_worker_adapters", crashing_adapters)
    try:
        result = await asyncio.wait_for(worker_module.main([worker_module.ANALYZE]), timeout=10)
    finally:
        get_settings.cache_clear()

    assert result == 1
    async with sessionmaker() as s:
        video = await s.get(Video, "v1")
        row = await s.get(PipelineLane, ANALYSIS_LANE)
    assert (video.status, video.claimed_at) == (VideoStatus.transcribed, None)
    assert "signal" in row.last_error
