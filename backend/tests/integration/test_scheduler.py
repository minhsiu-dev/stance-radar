from sqlalchemy import select

from app.models import Job, Video, VideoStatus
from app.pipeline import jobs
from app.pipeline.scheduler import AutoRefreshScheduler
from tests.conftest import wait_refresh


async def test_run_once_only_discovers(api, sessionmaker):
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)
    async with sessionmaker() as s:
        video = await s.get(Video, "alpha_vid_3")
        video.status = VideoStatus.pending
        await s.commit()

    await AutoRefreshScheduler(runner=app.state.runner, interval_minutes=60).run_once()

    async with sessionmaker() as s:
        kinds = [j.kind for j in (await s.execute(select(Job).order_by(Job.id))).scalars()]
        video = await s.get(Video, "alpha_vid_3")
    assert kinds == ["discover", "discover"]
    # pending videos belong to the transcript lane now, not to the scheduler
    assert video.status is VideoStatus.pending


async def test_run_once_skips_a_round_when_another_job_holds_the_slot(api, sessionmaker):
    app, _ = api
    async with sessionmaker() as s:
        await jobs.enqueue_job(s, kind="load_older", params={"channel_id": "UC_x"})

    await AutoRefreshScheduler(runner=app.state.runner, interval_minutes=60).run_once()

    async with sessionmaker() as s:
        kinds = [j.kind for j in (await s.execute(select(Job))).scalars()]
    assert kinds == ["load_older"]


async def test_start_noop_when_disabled(api):
    app, _ = api
    scheduler = AutoRefreshScheduler(runner=app.state.runner, interval_minutes=0)
    scheduler.start()
    assert scheduler._task is None
    await scheduler.stop()
