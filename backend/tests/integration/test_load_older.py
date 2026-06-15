from sqlalchemy import delete, func, select

from tests.conftest import wait_refresh
from app.models import Video, VideoStatus


async def _seed_alpha_trimmed(api) -> None:
    """Add alpha, discover imports 3 videos, then delete the two older ones,
    simulating an initial backfill that only fetched the newest one."""
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)
    async with app.state.sessionmaker() as s:
        await s.execute(
            delete(Video).where(Video.id.in_(["alpha_vid_1", "alpha_vid_2"]))
        )
        await s.commit()


async def test_load_older_pulls_older_videos_as_skipped(api):
    app, client = api
    await _seed_alpha_trimmed(api)

    # Precondition: only the newest one remains
    async with app.state.sessionmaker() as s:
        before = (await s.execute(
            select(Video.id).where(Video.channel_id == "UC_fake_alpha")
        )).scalars().all()
    assert sorted(before) == ["alpha_vid_3"]

    resp = await client.post("/api/channels/UC_fake_alpha/load-older")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["created"] is True
    assert data["job_id"] is not None

    await wait_refresh(app)

    async with app.state.sessionmaker() as s:
        rows = (await s.execute(
            select(Video.id, Video.status).where(Video.channel_id == "UC_fake_alpha")
        )).all()
    by_id = {vid: status for vid, status in rows}
    # The two older videos are back
    assert set(by_id) == {"alpha_vid_1", "alpha_vid_2", "alpha_vid_3"}
    # Older videos pulled backward all go to skipped (no review needed by default)
    assert by_id["alpha_vid_1"] == VideoStatus.skipped
    assert by_id["alpha_vid_2"] == VideoStatus.skipped


async def test_load_older_missing_channel_404(api):
    app, client = api
    resp = await client.post("/api/channels/UC_missing/load-older")
    assert resp.status_code == 404
