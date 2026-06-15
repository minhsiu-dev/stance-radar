from sqlalchemy import select

from app.models import Job, Video, VideoStatus
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


async def test_start_noop_when_disabled(api, sessionmaker):
    app, _ = api
    scheduler = AutoRefreshScheduler(
        runner=app.state.runner, sessionmaker=sessionmaker, interval_minutes=0,
    )
    scheduler.start()
    assert scheduler._task is None
    await scheduler.stop()
