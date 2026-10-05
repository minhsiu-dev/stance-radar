import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models import TRANSCRIPT_LANE, Channel, PipelineLane, Video, VideoStatus, utcnow
from app.pipeline.lanes import Lane
from app.pipeline.stages import NEUTRAL, SUCCESS, failure
from app.pipeline.transcript_stage import TranscriptStage
from app.transcripts.client import FakeTranscriptClient

BASE = datetime(2026, 6, 1, tzinfo=timezone.utc)


async def seed(sessionmaker, *ids, claimed=True) -> None:
    async with sessionmaker() as s:
        s.add(Channel(id="ch", title="c", thumbnail_url="", uploads_playlist_id="UU"))
        for day, vid_id in enumerate(ids):
            s.add(Video(
                id=vid_id, channel_id="ch", title=vid_id,
                published_at=BASE + timedelta(days=day), thumbnail_url="",
                status=VideoStatus.pending, claimed_at=utcnow() if claimed else None,
            ))
        await s.commit()


async def get(sessionmaker, vid_id) -> Video:
    async with sessionmaker() as s:
        return await s.get(Video, vid_id)


class RaisingClient:
    def __init__(self, exc: BaseException):
        self.exc = exc

    async def fetch(self, video_id):
        raise self.exc


async def test_success_stores_the_transcript_and_moves_on_to_analysis(sessionmaker):
    await seed(sessionmaker, "alpha_vid_3")
    stage = TranscriptStage(sessionmaker, FakeTranscriptClient())

    assert await stage.process("alpha_vid_3") == SUCCESS
    video = await get(sessionmaker, "alpha_vid_3")
    assert video.status is VideoStatus.transcribed
    assert video.transcript["language"] == "zh-TW"
    assert video.transcript["segments"][0]["start"] == 5.0
    assert video.transcript_language == "zh-TW"
    assert (video.transcript_attempts, video.analysis_attempts) == (1, 0)
    assert video.last_attempt_at is not None
    assert video.claimed_at is None
    assert video.error_message is None


async def test_an_unavailable_transcript_is_final_and_neutral(sessionmaker):
    await seed(sessionmaker, "beta_vid_1")  # the fakes have no transcript for it
    stage = TranscriptStage(sessionmaker, FakeTranscriptClient())

    assert await stage.process("beta_vid_1") == NEUTRAL
    video = await get(sessionmaker, "beta_vid_1")
    assert (video.status, video.transcript, video.claimed_at) == (
        VideoStatus.no_transcript, None, None,
    )


async def test_a_blocked_fetch_fails_the_video_and_reports_a_failure(sessionmaker):
    await seed(sessionmaker, "v")
    message = "RequestBlocked: YouTube is blocking requests from your IP"
    stage = TranscriptStage(sessionmaker, RaisingClient(RuntimeError(message)))

    assert await stage.process("v") == failure(message)
    video = await get(sessionmaker, "v")
    assert (video.status, video.error_message) == (VideoStatus.failed, message)
    assert video.transcript is None
    assert video.transcript_attempts == 1
    assert video.claimed_at is None


async def test_an_exception_without_a_message_still_leaves_a_readable_error(sessionmaker):
    await seed(sessionmaker, "v")
    stage = TranscriptStage(sessionmaker, RaisingClient(RuntimeError()))

    assert await stage.process("v") == failure("RuntimeError")
    assert (await get(sessionmaker, "v")).error_message == "RuntimeError"


async def test_cancelling_mid_fetch_gives_the_attempt_back(sessionmaker):
    await seed(sessionmaker, "v")
    reached = asyncio.Event()

    class HangingClient:
        async def fetch(self, video_id):
            reached.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(TranscriptStage(sessionmaker, HangingClient()).process("v"))
    await reached.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    video = await get(sessionmaker, "v")
    assert (video.status, video.transcript_attempts, video.claimed_at) == (
        VideoStatus.pending, 0, None,
    )


async def test_missing_video_is_neutral(sessionmaker):
    stage = TranscriptStage(sessionmaker, FakeTranscriptClient())
    assert await stage.process("deleted-with-its-channel") == NEUTRAL


async def test_five_blocked_fetches_in_a_row_pause_the_lane(sessionmaker):
    await seed(sessionmaker, *[f"v{i}" for i in range(7)], claimed=False)
    lane = Lane(
        name=TRANSCRIPT_LANE, input_status=VideoStatus.pending,
        stage=TranscriptStage(sessionmaker, RaisingClient(RuntimeError("blocked"))),
        sessionmaker=sessionmaker, concurrency=1, pause_after=5, poll_seconds=0.01,
    )

    assert await lane.drain() == 5
    async with sessionmaker() as s:
        by_status = dict((await s.execute(select(Video.id, Video.status))).all())
        row = await s.get(PipelineLane, TRANSCRIPT_LANE)
    assert list(by_status.values()).count(VideoStatus.failed) == 5
    # the lane claims newest first, so the two oldest are what's left in the queue
    assert sorted(v for v, st in by_status.items() if st is VideoStatus.pending) == ["v0", "v1"]
    assert (row.paused, row.pause_reason) == (True, "auto")
