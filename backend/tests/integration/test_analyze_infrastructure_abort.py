"""A signal-killed claude child must cost zero videos: they stay pending, attempts are
given back, and the whole job aborts instead of burning through the queue."""
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
