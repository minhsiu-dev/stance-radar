from datetime import datetime, timedelta, timezone

from app.models import Channel, Stance, Video, VideoStance, VideoStatus
from tests.conftest import wait_refresh


async def seed_stances(sessionmaker) -> None:
    """ch1 on AAPL: buy (40 days ago) → sell (2 days ago) = recent reversal.
    ch1 on NVDA: buy throughout, no flip."""
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


async def _seed_reversal_and_neutral_flip(sessionmaker) -> None:
    """ch1: AAPL buy→sell (reversal); TSLA buy→neutral (not a reversal, but still a flip)."""
    now = datetime.now(timezone.utc)
    async with sessionmaker() as s:
        s.add(Channel(
            id="ch1", title="頻道一", thumbnail_url="", uploads_playlist_id="UU1",
        ))
        for vid, day_offset, ticker, stance in (
            ("v_a1", 40, "AAPL", Stance.buy),
            ("v_a2", 2, "AAPL", Stance.sell),
            ("v_t1", 20, "TSLA", Stance.buy),
            ("v_t2", 3, "TSLA", Stance.neutral),
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


async def test_flips_reversals_only_excludes_neutral_flips(api, sessionmaker):
    _, client = api
    await _seed_reversal_and_neutral_flip(sessionmaker)

    # Default: both flips returned (AAPL reversal + TSLA going neutral)
    allf = (await client.get("/api/insights/flips?days=30")).json()["data"]["items"]
    assert {f["ticker"] for f in allf} == {"AAPL", "TSLA"}

    # reversals_only: keep only buy↔sell reversals
    rev = (await client.get(
        "/api/insights/flips?days=30&reversals_only=true"
    )).json()["data"]["items"]
    assert len(rev) == 1
    assert rev[0]["ticker"] == "AAPL"
    assert rev[0]["is_reversal"] is True


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
    assert data["benchmark"] == "VOO"
    assert data["horizons"] == [30, 90]
    assert data["total"] == 4
    assert data["page"] == 1
    assert data["page_size"] == 20
    assert "aggregates" not in data
    # neutral excluded; 4 buy/sell stances → 4 calls on the first page
    assert len(data["calls"]) == 4
    call = data["calls"][0]
    assert set(call) >= {
        "video_id", "ticker", "stance", "returns", "alpha", "has_data",
    }
    # FakeMarketClient has a VOO series → realized windows have alpha
    realized = [c for c in data["calls"] if c["returns"]["30"] is not None]
    assert realized
    assert all(c["alpha"]["30"] is not None for c in realized)


async def test_scorecard_pagination(api, sessionmaker):
    _, client = api
    await seed_stances(sessionmaker)
    p1 = (await client.get(
        "/api/channels/ch1/scorecard?page=1&page_size=2"
    )).json()["data"]
    assert p1["total"] == 4
    assert p1["page"] == 1
    assert p1["page_size"] == 2
    assert len(p1["calls"]) == 2
    p2 = (await client.get(
        "/api/channels/ch1/scorecard?page=2&page_size=2"
    )).json()["data"]
    assert p2["page"] == 2
    assert len(p2["calls"]) == 2
    # pages don't overlap (newest-first, distinct video/ticker keys)
    k1 = {(c["video_id"], c["ticker"]) for c in p1["calls"]}
    k2 = {(c["video_id"], c["ticker"]) for c in p2["calls"]}
    assert k1.isdisjoint(k2)


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


async def test_scorecard_filter_by_stance(api, sessionmaker):
    _, client = api
    await seed_stances(sessionmaker)
    buy = (await client.get("/api/channels/ch1/scorecard?stance=buy")).json()["data"]
    assert buy["total"] == 3
    assert all(c["stance"] == "buy" for c in buy["calls"])
    sell = (await client.get("/api/channels/ch1/scorecard?stance=sell")).json()["data"]
    assert sell["total"] == 1
    assert sell["calls"][0]["ticker"] == "AAPL"


async def test_scorecard_filter_by_ticker(api, sessionmaker):
    _, client = api
    await seed_stances(sessionmaker)
    aapl = (await client.get("/api/channels/ch1/scorecard?ticker=AAPL")).json()["data"]
    assert aapl["total"] == 2
    assert {c["ticker"] for c in aapl["calls"]} == {"AAPL"}
    combo = (await client.get(
        "/api/channels/ch1/scorecard?ticker=AAPL&stance=sell"
    )).json()["data"]
    assert combo["total"] == 1


async def test_scorecard_lists_distinct_tickers(api, sessionmaker):
    _, client = api
    await seed_stances(sessionmaker)
    data = (await client.get("/api/channels/ch1/scorecard")).json()["data"]
    assert data["tickers"] == ["AAPL", "NVDA"]
    filtered = (await client.get(
        "/api/channels/ch1/scorecard?stance=sell"
    )).json()["data"]
    assert filtered["tickers"] == ["AAPL", "NVDA"]


async def test_scorecard_invalid_stance_ignored(api, sessionmaker):
    _, client = api
    await seed_stances(sessionmaker)
    data = (await client.get("/api/channels/ch1/scorecard?stance=foo")).json()["data"]
    assert data["total"] == 4


async def test_channel_performance_shape_and_window(api, sessionmaker):
    _, client = api
    await seed_stances(sessionmaker)  # ch1: AAPL buy(40d)+sell(2d), NVDA buy(30d)+buy(3d)
    resp = await client.get("/api/channels/ch1/performance")
    assert resp.status_code == 200
    data = resp.json()["data"]

    assert data["benchmark"] == "VOO"
    assert data["window_days"] == 180
    assert data["horizons"] == ["now", "30", "90"]
    # 4 directional calls in window: 3 buy + 1 sell
    assert data["counts"] == {"all": 4, "buy": 3, "sell": 1}

    # All calls have price data (AAPL/NVDA/VOO are in the fake market) -> realized "now".
    assert data["summary"]["all"]["now"]["n"] == 4
    assert data["summary"]["all"]["now"]["win_rate"] is not None
    # No call is 90+ days old (max 40d) -> 90 horizon empty.
    assert data["summary"]["all"]["90"] == {
        "win_rate": None, "avg": None, "median": None,
        "avg_return": None, "median_return": None, "n": 0,
    }
    # At least the 40-day-old AAPL buy has matured to 30d.
    assert data["summary"]["all"]["30"]["n"] >= 1


async def test_channel_performance_unknown_channel_404(api):
    _, client = api
    resp = await client.get("/api/channels/does_not_exist/performance")
    assert resp.status_code == 404


async def test_auto_analyze_channel_ingests_new_videos_as_pending(api, sessionmaker):
    """auto_analyze channel: initial backfill stays discovered, subsequent new videos go straight to pending."""
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)

    async with sessionmaker() as s:
        videos = (await s.execute(
            Video.__table__.select().where(Video.channel_id == "UC_fake_alpha")
        )).all()
        assert {v.status for v in videos} == {"discovered"}
        # Simulate "only knows the oldest one": delete the two newer videos so the next discover treats them as newly published
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
        # analyze job hasn't run yet, so pending (or already picked up by the runner → analyzed)
        assert all(r.status in ("pending", "analyzed") for r in rows)
        assert all(r.status != "discovered" for r in rows)
