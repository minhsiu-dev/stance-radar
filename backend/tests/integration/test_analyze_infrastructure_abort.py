"""A signal-killed claude child must cost zero videos: they stay pending, attempts are
given back, and the whole job aborts instead of burning through the queue."""
import asyncio

import pytest
from sqlalchemy import select

from app.analysis.llm import AnalysisInfrastructureError
from app.analysis.tickers import TickerValidator
from app.config import Settings
from app.market.client import FakeMarketClient
from app.models import Channel, Job, JobKind, Video, VideoStatus, utcnow
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.transcripts.client import FakeTranscriptClient
from app.youtube.client import FakeYouTubeClient


class CrashingLLM:
    def __init__(self) -> None:
        self.calls = 0

    async def analyze(self, *, video_id, video_title, transcript):
        self.calls += 1
        raise AnalysisInfrastructureError("claude was killed by signal 11")


async def _seed(sessionmaker, count: int) -> None:
    async with sessionmaker() as session:
        session.add(Channel(
            id="UC1", title="c", thumbnail_url="", uploads_playlist_id="UU1",
        ))
        for i in range(count):
            session.add(Video(
                id=f"v{i}", channel_id="UC1", title=f"t{i}",
                published_at=utcnow(), thumbnail_url="",
                status=VideoStatus.pending, analysis_attempts=3,
                transcript={"language": "en", "segments": [
                    {"start": 0.0, "text": "hello"},
                ]},
            ))
        await session.commit()


async def test_signal_crash_leaves_videos_pending_and_aborts_the_job(sessionmaker):
    await _seed(sessionmaker, count=5)
    llm = CrashingLLM()
    runner = RefreshRunner(RefreshDeps(
        sessionmaker=sessionmaker,
        youtube=FakeYouTubeClient(),
        transcripts=FakeTranscriptClient(),
        llm=llm,
        ticker_validator=TickerValidator(FakeMarketClient()),
        settings=Settings(analysis_concurrency=1),
    ))

    job_id, created = await runner.start(JobKind.analyze)
    assert created
    with pytest.raises(AnalysisInfrastructureError):
        await runner.current_task

    async with sessionmaker() as session:
        videos = list((await session.execute(select(Video))).scalars().all())
        job = await session.get(Job, job_id)

    # zero videos burned: still pending, attempts handed back
    assert all(v.status is VideoStatus.pending for v in videos)
    assert all(v.analysis_attempts == 3 for v in videos)
    assert all(v.error_message is None for v in videos)
    # the job stopped at the first crash instead of chewing through all five
    assert llm.calls == 1
    assert job.error_message is not None and "signal" in job.error_message


async def test_signal_crash_rolls_back_a_cancelled_siblings_attempt_too(sessionmaker):
    """At the production default (analysis_concurrency=2+), a sibling video can be
    genuinely mid-flight -- past its own attempt-commit, suspended inside its own LLM
    call -- when the abort cancels it. That sibling was never actually analyzed, so its
    attempt must be handed back too, same as the crashing video's own attempt is.

    The concurrency=1 test above can't see a rollback bug here: at concurrency 1, every
    sibling is still blocked on the semaphore (never touched the DB, no attempt
    committed yet) when cancelled, so "nothing to roll back" is true by construction of
    that test's setup rather than by anything the implementation guarantees.

    `slow_reached` makes the ordering deterministic without depending on real
    scheduling/timing races: the crasher's analyze() call is structurally blocked from
    raising until the slow video's analyze() call proves it already got there (which
    can only happen after the slow video's own attempt-commit, earlier in
    _process_video) -- so this test can't accidentally pass because the crash happened
    to race ahead of the sibling.
    """
    await _seed(sessionmaker, count=1)  # video "v0" doubles as the crasher, attempts=3
    async with sessionmaker() as session:
        session.add(Video(
            id="v_slow", channel_id="UC1", title="slow",
            published_at=utcnow(), thumbnail_url="",
            status=VideoStatus.pending, analysis_attempts=3,
            transcript={"language": "en", "segments": [
                {"start": 0.0, "text": "hello"},
            ]},
        ))
        await session.commit()

    slow_reached = asyncio.Event()

    class OrderedCrashLLM:
        def __init__(self) -> None:
            self.calls = 0

        async def analyze(self, *, video_id, video_title, transcript):
            self.calls += 1
            if video_id == "v_slow":
                slow_reached.set()
                await asyncio.Event().wait()  # hangs until cancelled by the abort
            await slow_reached.wait()
            raise AnalysisInfrastructureError("claude was killed by signal 11")

    llm = OrderedCrashLLM()
    runner = RefreshRunner(RefreshDeps(
        sessionmaker=sessionmaker,
        youtube=FakeYouTubeClient(),
        transcripts=FakeTranscriptClient(),
        llm=llm,
        ticker_validator=TickerValidator(FakeMarketClient()),
        settings=Settings(analysis_concurrency=2),
    ))

    job_id, created = await runner.start(JobKind.analyze)
    assert created
    with pytest.raises(AnalysisInfrastructureError):
        await runner.current_task

    async with sessionmaker() as session:
        slow = await session.get(Video, "v_slow")
        job = await session.get(Job, job_id)

    # the cancelled sibling was never actually analyzed -- its attempt must be given back
    assert slow.status is VideoStatus.pending
    assert slow.analysis_attempts == 3
    assert slow.error_message is None
    assert job.error_message is not None and "signal" in job.error_message
