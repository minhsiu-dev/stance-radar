from datetime import datetime, timedelta, timezone

from app.models import Video, VideoStatus
from app.scripts.reanalyze_stale import reanalyze_stale
from tests.conftest import wait_refresh

OLD = datetime(2020, 1, 1, tzinfo=timezone.utc)
RECENT = datetime(2026, 6, 1, tzinfo=timezone.utc)
CUTOFF = datetime(2026, 1, 1, tzinfo=timezone.utc)


async def _analyze_alpha(app, client):
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)
    await client.post("/api/videos/analyze",
                      json={"video_ids": ["alpha_vid_2", "alpha_vid_3"]})
    await wait_refresh(app)


async def test_queues_only_stale_analyzed_videos_and_is_rerunnable(api, session):
    app, client = api
    await _analyze_alpha(app, client)
    v3 = await session.get(Video, "alpha_vid_3")
    v2 = await session.get(Video, "alpha_vid_2")
    v3.analyzed_at = OLD        # stale -> re-queued
    v2.analyzed_at = RECENT     # fresh -> left alone
    await session.commit()

    assert await reanalyze_stale(app.state.sessionmaker, before=CUTOFF, limit=None) == 1
    await session.refresh(v3)
    await session.refresh(v2)
    assert v3.status is VideoStatus.transcribed   # stored transcript: straight to analysis
    assert v2.status is VideoStatus.analyzed
    # already queued, so no longer `analyzed`: a re-run picks up nothing new
    assert await reanalyze_stale(app.state.sessionmaker, before=CUTOFF, limit=None) == 0

    await wait_refresh(app)
    await session.refresh(v3)
    assert v3.status is VideoStatus.analyzed
    assert v3.analyzed_at > CUTOFF


async def test_limit_takes_the_oldest_first(api, session):
    app, client = api
    await _analyze_alpha(app, client)
    v3 = await session.get(Video, "alpha_vid_3")
    v2 = await session.get(Video, "alpha_vid_2")
    v3.analyzed_at = OLD
    v2.analyzed_at = OLD - timedelta(days=1)
    await session.commit()

    assert await reanalyze_stale(app.state.sessionmaker, before=CUTOFF, limit=1) == 1
    await session.refresh(v3)
    await session.refresh(v2)
    assert v2.status is VideoStatus.transcribed
    assert v3.status is VideoStatus.analyzed
