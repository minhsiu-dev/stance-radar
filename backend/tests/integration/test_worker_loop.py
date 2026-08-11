"""The worker claims enqueued jobs and runs them; a signal crash ends the process so
Docker can restart it with a clean address space."""
import pytest
from sqlalchemy import select

from app.analysis.llm import AnalysisInfrastructureError
from app.analysis.tickers import TickerValidator
from app.config import Settings
from app.market.client import FakeMarketClient
from app.models import Channel, Job, JobStatus, Video, VideoStatus, utcnow
from app.pipeline import jobs
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.transcripts.client import FakeTranscriptClient
from app.worker import JobWorker
from app.youtube.client import FakeYouTubeClient


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
