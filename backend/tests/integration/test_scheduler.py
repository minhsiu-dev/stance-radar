import asyncio

from sqlalchemy import select

from app.models import Job, JobKind, Video, VideoStatus
from app.pipeline.scheduler import AutoRefreshScheduler
from tests.conftest import wait_refresh


async def test_run_once_discovers_then_analyzes_pending(api, sessionmaker):
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)

    scheduler = AutoRefreshScheduler(
        runner=app.state.runner, sessionmaker=sessionmaker, interval_minutes=60,
    )

    # all discovered, none pending -> only discover runs
    await scheduler.run_once()
    async with sessionmaker() as s:
        kinds = [j.kind for j in (await s.execute(select(Job))).scalars()]
    assert kinds.count("analyze") == 0

    # has pending -> analyze runs after discover
    async with sessionmaker() as s:
        video = await s.get(Video, "alpha_vid_3")
        video.status = VideoStatus.pending
        await s.commit()
    await scheduler.run_once()
    async with sessionmaker() as s:
        kinds = [j.kind for j in (await s.execute(select(Job))).scalars()]
        video = await s.get(Video, "alpha_vid_3")
    assert kinds.count("analyze") == 1
    assert video.status == VideoStatus.analyzed


async def test_run_once_waits_for_an_auto_started_analyze_job(api, sessionmaker):
    """Regression: RefreshRunner auto-starts analyze when a discover finishes with
    pending videos, so the scheduler's own start() returns created=False. run_once
    must still wait for that in-flight job rather than returning early."""
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)

    async with sessionmaker() as s:
        video = await s.get(Video, "alpha_vid_3")
        video.status = VideoStatus.pending
        await s.commit()

    scheduler = AutoRefreshScheduler(
        runner=app.state.runner, sessionmaker=sessionmaker, interval_minutes=60,
    )
    await scheduler.run_once()

    # No wait_refresh() here on purpose: run_once() itself must have waited.
    async with sessionmaker() as s:
        video = await s.get(Video, "alpha_vid_3")
    assert video.status == VideoStatus.analyzed


async def test_run_once_does_not_block_on_unrelated_job_holding_the_slot(
    api, sessionmaker, monkeypatch
):
    """Regression: RefreshRunner's single-job slot is global, not per-kind. If an
    unrelated job (e.g. a manually-triggered load_older backfill) grabs the slot
    in the window between the scheduler deciding analyze is needed and it calling
    start(JobKind.analyze) itself, that start() call also returns created=False --
    but run_once must NOT treat that as "the analyze job is in flight" and block
    on it. It must recognize the held job is the wrong kind and return promptly."""
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)

    # Make a load_older job hang indefinitely (until the test releases it), so
    # that if run_once incorrectly waited on it, this test would hang too.
    hold = asyncio.Event()

    async def blocked_run_load_older(self, job_id, *, channel_id):
        await hold.wait()

    monkeypatch.setattr(
        "app.pipeline.refresh.RefreshRunner._run_load_older", blocked_run_load_older
    )

    scheduler = AutoRefreshScheduler(
        runner=app.state.runner, sessionmaker=sessionmaker, interval_minutes=60,
    )
    real_has_pending_videos = scheduler._has_pending_videos

    async def has_pending_and_steal_the_slot() -> bool:
        # Simulate an unrelated actor (e.g. a different admin clicking
        # "load older" in the UI) grabbing the global job slot in the exact
        # window between the scheduler's own pending check and its
        # start(JobKind.analyze) call -- the race the fix must handle.
        async with sessionmaker() as s:
            video = await s.get(Video, "alpha_vid_3")
            video.status = VideoStatus.pending
            await s.commit()
        job_id, created = await app.state.runner.start(
            JobKind.load_older, channel_id="UC_fake_alpha"
        )
        assert created, "test setup: expected to freely grab the slot here"
        return await real_has_pending_videos()

    scheduler._has_pending_videos = has_pending_and_steal_the_slot

    await asyncio.wait_for(scheduler.run_once(), timeout=2)

    # run_once must have returned promptly without blocking on the load_older
    # job -- and, correspondingly, without having actually run analyze (the
    # slot was held by load_older, not analyze, for run_once's whole duration).
    async with sessionmaker() as s:
        video = await s.get(Video, "alpha_vid_3")
    assert video.status == VideoStatus.pending

    hold.set()  # release the held job so it can finish; don't leak a task
    await wait_refresh(app)


async def test_start_noop_when_disabled(api, sessionmaker):
    app, _ = api
    scheduler = AutoRefreshScheduler(
        runner=app.state.runner, sessionmaker=sessionmaker, interval_minutes=0,
    )
    scheduler.start()
    assert scheduler._task is None
    await scheduler.stop()
