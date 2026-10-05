import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.models import TRANSCRIPT_LANE, Channel, PipelineLane, Video, VideoStatus, utcnow
from app.pipeline import lane_store
from app.pipeline.lanes import Lane
from app.pipeline.stages import NEUTRAL, SUCCESS, failure

BASE = datetime(2026, 6, 1, tzinfo=timezone.utc)


async def seed(sessionmaker, ids, status=VideoStatus.pending) -> None:
    """ids are given oldest first: the last one is the newest video."""
    async with sessionmaker() as s:
        if await s.get(Channel, "ch") is None:
            s.add(Channel(id="ch", title="c", thumbnail_url="", uploads_playlist_id="UU"))
        for day, vid_id in enumerate(ids):
            s.add(Video(
                id=vid_id, channel_id="ch", title=vid_id,
                published_at=BASE + timedelta(days=day), thumbnail_url="", status=status,
            ))
        await s.commit()


async def finish(sessionmaker, video_id, status=VideoStatus.transcribed) -> None:
    async with sessionmaker() as s:
        await s.execute(
            update(Video).where(Video.id == video_id).values(status=status, claimed_at=None)
        )
        await s.commit()


async def statuses(sessionmaker) -> dict[str, VideoStatus]:
    async with sessionmaker() as s:
        rows = (await s.execute(select(Video.id, Video.status))).all()
    return dict(rows)


async def lane_row(sessionmaker) -> PipelineLane:
    async with sessionmaker() as s:
        return await s.get(PipelineLane, TRANSCRIPT_LANE)


class RecordingStage:
    def __init__(self, sessionmaker, outcome=SUCCESS, delay=0.0):
        self.sessionmaker = sessionmaker
        self.outcome = outcome
        self.delay = delay
        self.seen: list[str] = []
        self.active = 0
        self.max_active = 0

    async def process(self, video_id):
        self.seen.append(video_id)
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            await asyncio.sleep(self.delay)
            await finish(self.sessionmaker, video_id)
            return self.outcome
        finally:
            self.active -= 1


def make_lane(sessionmaker, stage, *, concurrency=1, pause_after=5, fatal=()):
    return Lane(
        name=TRANSCRIPT_LANE, input_status=VideoStatus.pending, stage=stage,
        sessionmaker=sessionmaker, concurrency=concurrency, pause_after=pause_after,
        poll_seconds=0.01, fatal=fatal,
    )


async def test_drain_processes_its_input_newest_first_and_nothing_else(sessionmaker):
    await seed(sessionmaker, ["v0", "v1", "v2"])
    await seed(sessionmaker, ["elsewhere"], status=VideoStatus.transcribed)
    stage = RecordingStage(sessionmaker)

    assert await make_lane(sessionmaker, stage).drain() == 3
    assert stage.seen == ["v2", "v1", "v0"]
    assert "elsewhere" not in stage.seen


async def test_drain_never_runs_more_slots_than_the_concurrency(sessionmaker):
    await seed(sessionmaker, [f"v{i}" for i in range(6)])
    stage = RecordingStage(sessionmaker, delay=0.02)

    assert await make_lane(sessionmaker, stage, concurrency=3).drain() == 6
    assert stage.max_active == 3


async def test_a_paused_lane_claims_nothing(sessionmaker):
    await seed(sessionmaker, ["v0"])
    await lane_store.ensure_lanes(sessionmaker)
    await lane_store.pause(sessionmaker, TRANSCRIPT_LANE)
    stage = RecordingStage(sessionmaker)

    assert await make_lane(sessionmaker, stage).drain() == 0
    assert stage.seen == []


async def test_a_failure_streak_pauses_the_lane_and_stops_claiming(sessionmaker):
    await seed(sessionmaker, [f"v{i}" for i in range(5)])
    stage = RecordingStage(sessionmaker, outcome=failure("blocked"))

    assert await make_lane(sessionmaker, stage, pause_after=2).drain() == 2
    row = await lane_row(sessionmaker)
    assert (row.paused, row.pause_reason, row.last_error) == (True, "auto", "blocked")
    left = await statuses(sessionmaker)
    assert sorted(v for v, s in left.items() if s is VideoStatus.pending) == ["v0", "v1", "v2"]


async def test_success_resets_the_streak(sessionmaker):
    await seed(sessionmaker, ["v0"])
    await lane_store.ensure_lanes(sessionmaker)
    for _ in range(3):
        await lane_store.record_failure(sessionmaker, TRANSCRIPT_LANE, "x", pause_after=10)

    await make_lane(sessionmaker, RecordingStage(sessionmaker)).drain()
    assert (await lane_row(sessionmaker)).consecutive_failures == 0


async def test_neutral_leaves_the_streak_alone(sessionmaker):
    await seed(sessionmaker, ["v0"])
    await lane_store.ensure_lanes(sessionmaker)
    for _ in range(3):
        await lane_store.record_failure(sessionmaker, TRANSCRIPT_LANE, "x", pause_after=10)

    await make_lane(sessionmaker, RecordingStage(sessionmaker, outcome=NEUTRAL)).drain()
    assert (await lane_row(sessionmaker)).consecutive_failures == 3


async def test_a_crashing_stage_fails_the_video_without_wedging_its_claim(sessionmaker):
    await seed(sessionmaker, ["v0"])

    class CrashingStage:
        async def process(self, video_id):
            raise ValueError()  # no message on purpose

    await make_lane(sessionmaker, CrashingStage()).drain()
    async with sessionmaker() as s:
        row = await s.get(Video, "v0")
    assert (row.status, row.claimed_at) == (VideoStatus.failed, None)
    assert row.error_message == "ValueError"
    assert (await lane_row(sessionmaker)).consecutive_failures == 1


class Boom(Exception):
    pass


async def test_a_fatal_error_cancels_the_other_slots_records_it_and_reraises(sessionmaker):
    await seed(sessionmaker, ["crash", "slow"])  # "slow" is newer: claimed first

    class FatalStage:
        def __init__(self):
            self.slow_started = asyncio.Event()
            self.sibling_cancelled = False

        async def process(self, video_id):
            if video_id == "slow":
                self.slow_started.set()
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    self.sibling_cancelled = True
                    raise
            await self.slow_started.wait()
            raise Boom("claude was killed by signal 11")

    stage = FatalStage()
    with pytest.raises(Boom):
        await make_lane(sessionmaker, stage, concurrency=2, fatal=(Boom,)).drain()
    assert stage.sibling_cancelled is True
    row = await lane_row(sessionmaker)
    assert "signal" in row.last_error
    assert row.paused is False  # a broken process is not a failure streak


async def test_startup_releases_only_its_own_claims_and_reports_in(sessionmaker):
    async with sessionmaker() as s:
        s.add(Channel(id="ch", title="c", thumbnail_url="", uploads_playlist_id="UU"))
        s.add(Video(id="mine", channel_id="ch", title="m", published_at=BASE,
                    thumbnail_url="", status=VideoStatus.pending, claimed_at=utcnow()))
        s.add(Video(id="theirs", channel_id="ch", title="t", published_at=BASE,
                    thumbnail_url="", status=VideoStatus.transcribed, claimed_at=utcnow()))
        await s.commit()

    lane = make_lane(sessionmaker, RecordingStage(sessionmaker), concurrency=3)
    assert await lane.startup() == 1
    async with sessionmaker() as s:
        assert (await s.get(Video, "mine")).claimed_at is None
        assert (await s.get(Video, "theirs")).claimed_at is not None
    row = await lane_row(sessionmaker)
    assert row.concurrency == 3
    assert row.last_heartbeat_at is not None


async def test_a_fatal_error_with_no_message_falls_back_to_class_name(sessionmaker):
    await seed(sessionmaker, ["v0"])

    class FatalStage:
        async def process(self, video_id):
            raise Boom()  # no message on purpose

    stage = FatalStage()
    with pytest.raises(Boom):
        await make_lane(sessionmaker, stage, fatal=(Boom,)).drain()
    row = await lane_row(sessionmaker)
    assert row.last_error == "Boom"


async def test_a_crash_after_the_stage_commits_does_not_fail_the_video(sessionmaker):
    await seed(sessionmaker, ["v0"])

    class PostCommitCrashStage:
        async def process(self, video_id):
            # Stage commits its result first
            await finish(sessionmaker, video_id)
            # Then crashes
            raise ValueError("late")

    await make_lane(sessionmaker, PostCommitCrashStage()).drain()
    async with sessionmaker() as s:
        row = await s.get(Video, "v0")
    # The video was already finished by the stage, so it should stay transcribed
    assert row.status == VideoStatus.transcribed
    assert row.claimed_at is None
