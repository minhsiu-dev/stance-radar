import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.analysis.types import UsageSnapshot, UsageWindow
from app.models import (
    ANALYSIS_LANE, TRANSCRIPT_LANE, Channel, PipelineLane, Video, VideoStatus, utcnow,
)
from app.pipeline import lane_store

BASE = datetime(2026, 6, 1, tzinfo=timezone.utc)


async def seed(sessionmaker, *rows) -> None:
    """rows: (video_id, status, day[, claimed]) -- a higher day is a newer video."""
    async with sessionmaker() as s:
        s.add(Channel(id="ch", title="c", thumbnail_url="", uploads_playlist_id="UU"))
        for row in rows:
            vid_id, status, day = row[:3]
            claimed = row[3] if len(row) > 3 else False
            s.add(Video(
                id=vid_id, channel_id="ch", title=vid_id,
                published_at=BASE + timedelta(days=day), thumbnail_url="",
                status=status, claimed_at=utcnow() if claimed else None,
            ))
        await s.commit()


async def video(sessionmaker, vid_id) -> Video:
    async with sessionmaker() as s:
        return await s.get(Video, vid_id)


async def lane_row(sessionmaker, lane) -> PipelineLane:
    async with sessionmaker() as s:
        return await s.get(PipelineLane, lane)


async def test_claim_takes_the_newest_unclaimed_video_of_the_status(sessionmaker):
    await seed(
        sessionmaker,
        ("old", VideoStatus.pending, 1),
        ("new", VideoStatus.pending, 3),
        ("other-lane", VideoStatus.transcribed, 5),
    )
    assert await lane_store.claim_next(sessionmaker, VideoStatus.pending) == "new"
    assert await lane_store.claim_next(sessionmaker, VideoStatus.pending) == "old"
    assert await lane_store.claim_next(sessionmaker, VideoStatus.pending) is None
    assert (await video(sessionmaker, "new")).claimed_at is not None
    assert (await video(sessionmaker, "other-lane")).claimed_at is None


async def test_concurrent_claims_never_return_the_same_video(sessionmaker):
    await seed(sessionmaker, *[(f"v{i}", VideoStatus.pending, i) for i in range(6)])
    claims = await asyncio.gather(*[
        lane_store.claim_next(sessionmaker, VideoStatus.pending) for _ in range(6)
    ])
    assert sorted(claims) == [f"v{i}" for i in range(6)]


async def test_claim_skips_a_row_another_transaction_holds(sessionmaker):
    """api/videos.py locks the rows it is about to re-status (skip / re-queue). A lane
    slot must step around such a row rather than claim a video that is about to be
    skipped out from under it."""
    await seed(
        sessionmaker,
        ("held", VideoStatus.pending, 2),
        ("free", VideoStatus.pending, 1),
    )
    async with sessionmaker() as holder:
        await holder.execute(select(Video).where(Video.id == "held").with_for_update())
        assert await lane_store.claim_next(sessionmaker, VideoStatus.pending) == "free"
        await holder.rollback()


async def test_release_claims_only_touches_the_given_status(sessionmaker):
    await seed(
        sessionmaker,
        ("fetching", VideoStatus.pending, 1, True),
        ("analyzing", VideoStatus.transcribed, 2, True),
    )
    assert await lane_store.release_claims(sessionmaker, VideoStatus.transcribed) == 1
    assert (await video(sessionmaker, "analyzing")).claimed_at is None
    assert (await video(sessionmaker, "fetching")).claimed_at is not None


async def test_fail_video_marks_it_failed_and_releases_the_claim(sessionmaker):
    await seed(sessionmaker, ("v", VideoStatus.pending, 1, True))
    await lane_store.fail_video(sessionmaker, "v", "boom")
    row = await video(sessionmaker, "v")
    assert (row.status, row.error_message, row.claimed_at) == (VideoStatus.failed, "boom", None)


async def test_fail_video_with_status_filter_does_not_fail_if_status_mismatch(sessionmaker):
    await seed(sessionmaker, ("v", VideoStatus.transcribed, 1))
    await lane_store.fail_video(sessionmaker, "v", "boom", status=VideoStatus.pending)
    row = await video(sessionmaker, "v")
    # Status should not change because the WHERE clause filtered it out
    assert row.status == VideoStatus.transcribed
    assert row.error_message is None
    assert row.claimed_at is None


async def test_ensure_lanes_is_idempotent_and_a_missing_row_reads_as_not_paused(sessionmaker):
    assert await lane_store.is_paused(sessionmaker, ANALYSIS_LANE) is False
    await lane_store.ensure_lanes(sessionmaker)
    await lane_store.ensure_lanes(sessionmaker)
    async with sessionmaker() as s:
        count = (await s.execute(select(func.count()).select_from(PipelineLane))).scalar_one()
    assert count == 2


async def test_failure_streak_pauses_the_lane_at_the_threshold(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    assert await lane_store.record_failure(
        sessionmaker, TRANSCRIPT_LANE, "blocked 1", pause_after=2
    ) is False
    assert await lane_store.record_failure(
        sessionmaker, TRANSCRIPT_LANE, "blocked 2", pause_after=2
    ) is True
    row = await lane_row(sessionmaker, TRANSCRIPT_LANE)
    assert row.paused is True
    assert row.pause_reason == "auto"
    assert row.paused_at is not None
    assert row.consecutive_failures == 2
    assert row.last_error == "blocked 2"
    assert row.last_error_at is not None
    assert (await lane_row(sessionmaker, ANALYSIS_LANE)).paused is False


async def test_success_resets_the_streak(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    await lane_store.record_failure(sessionmaker, TRANSCRIPT_LANE, "x", pause_after=5)
    await lane_store.record_success(sessionmaker, TRANSCRIPT_LANE)
    assert (await lane_row(sessionmaker, TRANSCRIPT_LANE)).consecutive_failures == 0


async def test_a_manual_pause_keeps_its_reason_through_failures(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    await lane_store.pause(sessionmaker, ANALYSIS_LANE)
    assert await lane_store.record_failure(
        sessionmaker, ANALYSIS_LANE, "quota", pause_after=1
    ) is True
    assert (await lane_row(sessionmaker, ANALYSIS_LANE)).pause_reason == "manual"


async def test_resume_clears_the_pause_and_streak_but_keeps_the_last_error(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    await lane_store.record_failure(sessionmaker, ANALYSIS_LANE, "quota", pause_after=1)
    await lane_store.resume(sessionmaker, ANALYSIS_LANE)
    row = await lane_row(sessionmaker, ANALYSIS_LANE)
    assert (row.paused, row.pause_reason, row.paused_at) == (False, None, None)
    assert row.consecutive_failures == 0
    assert row.last_error == "quota"


async def test_mark_started_records_concurrency_and_a_heartbeat(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    await lane_store.mark_started(sessionmaker, ANALYSIS_LANE, 5)
    row = await lane_row(sessionmaker, ANALYSIS_LANE)
    assert row.concurrency == 5
    assert row.last_heartbeat_at is not None


async def test_record_error_leaves_the_pause_flag_alone(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    await lane_store.record_error(sessionmaker, ANALYSIS_LANE, "killed by signal 11")
    row = await lane_row(sessionmaker, ANALYSIS_LANE)
    assert row.last_error == "killed by signal 11"
    assert row.paused is False
    assert row.consecutive_failures == 0


# ---- usage limit pause / auto-resume ----


async def test_pause_for_limit_sets_reason_resume_at_and_error(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    at = utcnow() + timedelta(hours=2)
    await lane_store.pause_for_limit(sessionmaker, ANALYSIS_LANE, at, "5-hour usage 72% >= 70%")
    row = await lane_row(sessionmaker, ANALYSIS_LANE)
    assert (row.paused, row.pause_reason, row.resume_at, row.last_error) == (
        True, "limit", at, "5-hour usage 72% >= 70%",
    )
    assert row.consecutive_failures == 0


async def test_pause_for_limit_keeps_the_later_resume_at(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    later, earlier = utcnow() + timedelta(days=3), utcnow() + timedelta(hours=1)
    await lane_store.pause_for_limit(sessionmaker, ANALYSIS_LANE, later, "a")
    await lane_store.pause_for_limit(sessionmaker, ANALYSIS_LANE, earlier, "b")
    assert (await lane_row(sessionmaker, ANALYSIS_LANE)).resume_at == later


async def test_pause_for_limit_does_not_override_a_manual_pause(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    await lane_store.pause(sessionmaker, ANALYSIS_LANE)
    await lane_store.pause_for_limit(sessionmaker, ANALYSIS_LANE, utcnow(), "x")
    row = await lane_row(sessionmaker, ANALYSIS_LANE)
    assert row.pause_reason == "manual" and row.resume_at is None


async def test_resume_if_due_only_after_resume_at(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    at = utcnow() + timedelta(minutes=5)
    await lane_store.pause_for_limit(sessionmaker, ANALYSIS_LANE, at, "x")
    assert await lane_store.resume_if_due(
        sessionmaker, ANALYSIS_LANE, at - timedelta(seconds=1)
    ) is False
    assert await lane_store.resume_if_due(sessionmaker, ANALYSIS_LANE, at) is True
    row = await lane_row(sessionmaker, ANALYSIS_LANE)
    assert (row.paused, row.pause_reason, row.resume_at) == (False, None, None)


async def test_resume_if_due_ignores_manual_and_auto_pauses(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    far = utcnow() + timedelta(days=30)
    await lane_store.pause(sessionmaker, ANALYSIS_LANE)
    assert await lane_store.resume_if_due(sessionmaker, ANALYSIS_LANE, far) is False
    await lane_store.resume(sessionmaker, ANALYSIS_LANE)
    await lane_store.record_failure(sessionmaker, ANALYSIS_LANE, "boom", pause_after=1)
    assert await lane_store.resume_if_due(sessionmaker, ANALYSIS_LANE, far) is False
    assert (await lane_row(sessionmaker, ANALYSIS_LANE)).pause_reason == "auto"


async def test_manual_resume_clears_resume_at(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    await lane_store.pause_for_limit(
        sessionmaker, ANALYSIS_LANE, utcnow() + timedelta(hours=1), "x"
    )
    await lane_store.resume(sessionmaker, ANALYSIS_LANE)
    assert (await lane_row(sessionmaker, ANALYSIS_LANE)).resume_at is None


async def test_record_usage_stores_the_snapshot_json(sessionmaker):
    await lane_store.ensure_lanes(sessionmaker)
    reset = datetime(2026, 10, 10, 15, tzinfo=timezone.utc)
    await lane_store.record_usage(
        sessionmaker, ANALYSIS_LANE,
        UsageSnapshot("allowed", UsageWindow(0.15, reset), None, reset),
    )
    usage = (await lane_row(sessionmaker, ANALYSIS_LANE)).usage
    assert usage["five_hour"] == {"utilization": 0.15, "resets_at": reset.isoformat()}
    assert usage["seven_day"] is None and "at" in usage
