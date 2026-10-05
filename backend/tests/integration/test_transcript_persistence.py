from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import Mention, Video
from tests.conftest import wait_refresh


async def _discover_and_analyze(app, client, video_id):
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)
    await client.post("/api/videos/analyze", json={"video_ids": [video_id]})
    await wait_refresh(app)


async def test_analysis_stores_transcript(api, session):
    app, client = api
    await _discover_and_analyze(app, client, "alpha_vid_3")

    video = await session.get(Video, "alpha_vid_3")
    assert video.transcript is not None
    assert video.transcript["language"] == "zh-TW"
    # segments round-trip with timing + text
    assert video.transcript["segments"][0]["start"] == 5.0
    assert "蘋果" in video.transcript["segments"][0]["text"]


async def test_reanalyze_reuses_stored_transcript_without_fetching(api, session, monkeypatch):
    app, client = api
    await _discover_and_analyze(app, client, "alpha_vid_3")

    async def no_fetch(video_id):
        raise AssertionError("fetch must not be called when a transcript is stored")

    monkeypatch.setattr(app.state.transcript_lane.stage.client, "fetch", no_fetch)
    resp = await client.post("/api/videos/analyze", json={"video_ids": ["alpha_vid_3"]})
    assert resp.json()["data"]["analysis"] == 1
    await wait_refresh(app)

    video = await session.get(Video, "alpha_vid_3")
    await session.refresh(video)
    assert video.status.value == "analyzed"
    # Load mentions explicitly (lazy loading doesn't work in async context without greenlet)
    mentions = list((await session.execute(
        select(Mention).where(Mention.video_id == "alpha_vid_3")
    )).scalars().all())
    # alpha_vid_3 mentions AAPL (per the fakes) — still produced from the stored transcript
    assert any(m.ticker == "AAPL" for m in mentions)
