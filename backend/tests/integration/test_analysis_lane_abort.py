"""A signal-killed claude child must cost zero videos: they stay queued, attempts
are given back, and the lane aborts instead of burning through the queue."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.analysis.llm import AnalysisInfrastructureError
from app.analysis.tickers import TickerValidator
from app.config import Settings
from app.market.client import FakeMarketClient
from app.models import ANALYSIS_LANE, Channel, PipelineLane, Video, VideoStatus
from app.pipeline.lane_factory import build_analysis_lane

STORED = {"language": "en", "segments": [{"start": 0.0, "text": "hello"}]}
BASE = datetime(2026, 6, 1, tzinfo=timezone.utc)


async def seed(sessionmaker, *ids) -> None:
    async with sessionmaker() as s:
        s.add(Channel(id="UC1", title="c", thumbnail_url="", uploads_playlist_id="UU1"))
        for day, vid_id in enumerate(ids):
            s.add(Video(
                id=vid_id, channel_id="UC1", title=vid_id,
                published_at=BASE + timedelta(days=day), thumbnail_url="",
                status=VideoStatus.transcribed, analysis_attempts=3, transcript=STORED,
            ))
        await s.commit()


def make_lane(sessionmaker, llm, concurrency):
    settings = Settings(analysis_concurrency=concurrency, worker_poll_seconds=0.01, _env_file=None)
    return build_analysis_lane(sessionmaker, llm, TickerValidator(FakeMarketClient()), settings)


async def test_signal_crash_leaves_videos_queued_and_aborts_the_lane(sessionmaker):
    await seed(sessionmaker, *[f"v{i}" for i in range(5)])

    class CrashingLLM:
        calls = 0

        async def analyze(self, *, video_id, video_title, transcript):
            CrashingLLM.calls += 1
            raise AnalysisInfrastructureError("claude was killed by signal 11")

    with pytest.raises(AnalysisInfrastructureError):
        await make_lane(sessionmaker, CrashingLLM(), concurrency=1).drain()

    async with sessionmaker() as s:
        videos = (await s.execute(select(Video))).scalars().all()
        row = await s.get(PipelineLane, ANALYSIS_LANE)
    # zero videos burned: still queued, attempts handed back, claims released
    assert all(v.status is VideoStatus.transcribed for v in videos)
    assert all(v.analysis_attempts == 3 for v in videos)
    assert all(v.error_message is None and v.claimed_at is None for v in videos)
    # stopped at the first crash instead of chewing through all five
    assert CrashingLLM.calls == 1
    assert "signal" in row.last_error
    assert row.paused is False


async def test_signal_crash_rolls_back_a_cancelled_siblings_attempt_too(sessionmaker):
    """A sibling can be genuinely mid-flight -- past its own attempt-commit, suspended
    inside its own LLM call -- when the abort cancels it. It was never analysed, so its
    attempt must be handed back too. `slow_reached` makes the ordering deterministic:
    the crasher cannot raise until the slow video's call proves it already got there."""
    await seed(sessionmaker, "v0", "v_slow")  # v_slow is newer: claimed first
    slow_reached = asyncio.Event()

    class OrderedCrashLLM:
        async def analyze(self, *, video_id, video_title, transcript):
            if video_id == "v_slow":
                slow_reached.set()
                await asyncio.Event().wait()  # hangs until cancelled by the abort
            await slow_reached.wait()
            raise AnalysisInfrastructureError("claude was killed by signal 11")

    with pytest.raises(AnalysisInfrastructureError):
        await make_lane(sessionmaker, OrderedCrashLLM(), concurrency=2).drain()

    async with sessionmaker() as s:
        slow = await s.get(Video, "v_slow")
    assert slow.status is VideoStatus.transcribed
    assert slow.analysis_attempts == 3
    assert slow.claimed_at is None
