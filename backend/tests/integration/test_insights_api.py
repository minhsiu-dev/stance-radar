from datetime import datetime, timedelta, timezone

from app.models import Channel, Stance, Video, VideoStance, VideoStatus
from tests.conftest import wait_refresh


async def seed_stances(sessionmaker) -> None:
    """ch1 對 AAPL:buy(40 天前)→ sell(2 天前)= 近期 reversal。
    ch1 對 NVDA:一路 buy,無 flip。"""
    now = datetime.now(timezone.utc)
    async with sessionmaker() as s:
        s.add(Channel(
            id="ch1", title="頻道一", thumbnail_url="", uploads_playlist_id="UU1",
        ))
        for vid, day_offset, ticker, stance in (
            ("v_a1", 40, "AAPL", Stance.buy),
            ("v_a2", 2, "AAPL", Stance.sell),
            ("v_n1", 30, "NVDA", Stance.buy),
            ("v_n2", 3, "NVDA", Stance.buy),
        ):
            s.add(Video(
                id=vid, channel_id="ch1", title=f"title {vid}",
                published_at=now - timedelta(days=day_offset),
                thumbnail_url="", duration_seconds=60,
                status=VideoStatus.analyzed,
            ))
            s.add(VideoStance(
                video_id=vid, ticker=ticker, stance=stance, summary="s",
            ))
        await s.commit()


async def test_flips_endpoint_detects_recent_reversal(api, sessionmaker):
    _, client = api
    await seed_stances(sessionmaker)
    resp = await client.get("/api/insights/flips?days=30")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["window_days"] == 30
    assert len(data["items"]) == 1
    flip = data["items"][0]
    assert flip["ticker"] == "AAPL"
    assert flip["is_reversal"] is True
    assert flip["direction"] == "bearish"
    assert flip["prev"]["stance"] == "buy"
    assert flip["curr"]["stance"] == "sell"
    assert flip["curr"]["video_id"] == "v_a2"


async def test_flips_window_excludes_old_flips(api, sessionmaker):
    _, client = api
    await seed_stances(sessionmaker)
    resp = await client.get("/api/insights/flips?days=1")
    assert resp.json()["data"]["items"] == []


async def test_scorecard_unknown_channel_404(api):
    _, client = api
    resp = await client.get("/api/channels/nope/scorecard")
    assert resp.status_code == 404


async def test_scorecard_shape_with_fake_market(api, sessionmaker):
    _, client = api
    await seed_stances(sessionmaker)
    resp = await client.get("/api/channels/ch1/scorecard")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["benchmark"] == "SPY"
    assert data["horizons"] == [7, 30, 90]
    # neutral 不計;4 筆立場全是 buy/sell → 4 個 call
    assert len(data["calls"]) == 4
    call = data["calls"][0]
    assert set(call) >= {
        "video_id", "ticker", "stance", "returns", "alpha", "has_data",
    }
    aggregates = data["aggregates"]
    assert aggregates["buy"]["total"] == 3
    assert aggregates["sell"]["total"] == 1
    # FakeMarketClient 含 SPY benchmark → 已實現(returns 有值)的窗口 alpha 應有值
    realized = [c for c in data["calls"] if c["returns"]["7"] is not None]
    assert realized
    assert all(c["alpha"]["7"] is not None for c in realized)


async def test_leaderboard_ranks_channels(api, sessionmaker):
    _, client = api
    await seed_stances(sessionmaker)
    resp = await client.get("/api/insights/leaderboard")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["horizon_days"] == 30
    assert len(data["items"]) == 1
    item = data["items"][0]
    assert item["channel_id"] == "ch1"
    assert item["calls_total"] == 4
    assert "avg_call_alpha_30d" in item
    assert "buy" in item and "sell" in item


async def test_auto_analyze_channel_ingests_new_videos_as_pending(api, sessionmaker):
    """auto_analyze 頻道:初次 backfill 仍 discovered,後續新片直接 pending。"""
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)

    async with sessionmaker() as s:
        videos = (await s.execute(
            Video.__table__.select().where(Video.channel_id == "UC_fake_alpha")
        )).all()
        assert {v.status for v in videos} == {"discovered"}
        # 模擬「只認得最舊一部」:刪掉較新兩部,下次 discover 視為新發布
        await s.execute(
            Video.__table__.delete().where(
                Video.id.in_(["alpha_vid_2", "alpha_vid_3"])
            )
        )
        await s.commit()

    resp = await client.patch(
        "/api/channels/UC_fake_alpha", json={"auto_analyze": True}
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["auto_analyze"] is True

    await client.post("/api/refresh")
    await wait_refresh(app)

    async with sessionmaker() as s:
        rows = (await s.execute(
            Video.__table__.select().where(
                Video.id.in_(["alpha_vid_2", "alpha_vid_3"])
            )
        )).all()
        # analyze job 還沒跑,所以是 pending(或已被 runner 接著跑掉 → analyzed)
        assert all(r.status in ("pending", "analyzed") for r in rows)
        assert all(r.status != "discovered" for r in rows)
