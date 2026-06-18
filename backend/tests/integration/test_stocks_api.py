import pytest

from tests.conftest import wait_refresh


async def seed(api) -> tuple:
    app, client = api
    await client.post(
        "/api/channels", json={"channel_ids": "UC_fake_alpha UC_fake_beta"}
    )
    await wait_refresh(app)  # discover
    discovered = (await client.get(
        "/api/videos", params={"status": "discovered"}
    )).json()["data"]
    video_ids = [v["id"] for g in discovered["groups"] for v in g["videos"]]
    await client.post("/api/videos/analyze", json={"video_ids": video_ids})
    await wait_refresh(app)  # analyze
    return app, client


async def test_list_mentioned_stocks_with_counts(api):
    app, client = await seed(api)
    resp = await client.get("/api/stocks")
    data = resp.json()["data"]
    # AAPL has 2 mentions, NVDA 2, TSLA 1; ordered by count descending
    assert data[0]["ticker"] in {"AAPL", "NVDA"}
    assert {row["ticker"]: row["mention_count"] for row in data} == {
        "AAPL": 2, "NVDA": 2, "TSLA": 1,
    }


async def test_stock_summary_and_unknown_404(api):
    app, client = api
    resp = await client.get("/api/stocks/AAPL")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["ticker"] == "AAPL"
    assert data["name"] == "Apple Inc."
    assert data["price"] is not None
    assert "pe_ratio" in data and "market_cap" in data

    resp = await client.get("/api/stocks/ZZZZ")
    assert resp.status_code == 404


async def test_candles_default_range_and_invalid_range(api):
    app, client = api
    resp = await client.get("/api/stocks/AAPL/candles")
    body = resp.json()
    data = body["data"]
    # default 1y -> now goes through PriceStore; day count derived from calendar days (250-270 trading days)
    assert len(data) > 200
    assert "time" in body["data"][0]
    assert "date" not in body["data"][0]
    assert set(data[0]) == {"time", "open", "high", "low", "close", "volume"}

    resp = await client.get("/api/stocks/AAPL/candles", params={"range": "2w"})
    assert resp.status_code == 422


async def test_stock_stances_ascending_for_chart(api):
    app, client = await seed(api)
    resp = await client.get("/api/stocks/AAPL/stances")
    data = resp.json()["data"]
    assert [row["video_id"] for row in data] == ["beta_vid_2", "alpha_vid_3"]  # old -> new
    assert data[1] == {
        "video_id": "alpha_vid_3",
        "video_title": "AAPL 財報解讀",
        "channel_id": "UC_fake_alpha",
        "channel_title": "頻道 Alpha",
        "published_at": data[1]["published_at"],
        "stance": "buy",
        "summary": "財報強勁,整體看多 AAPL",
        "confidence": "high",
    }


async def test_stock_mentions_grouped_per_video_with_deep_links(api):
    app, client = await seed(api)
    resp = await client.get("/api/stocks/AAPL/mentions")
    data = resp.json()["data"]
    assert [row["video_id"] for row in data] == ["alpha_vid_3", "beta_vid_2"]  # new -> old
    first = data[0]
    # video-level fields
    assert first["stance"] == "buy"  # from VideoStance (the video's overall stance)
    assert first["summary"] == "財報強勁,整體看多 AAPL"
    assert first["channel_thumbnail"] is not None
    assert first["youtube_url"] == "https://www.youtube.com/watch?v=alpha_vid_3"
    # nested mentions: one row per mention, with a deep link
    m = first["mentions"][0]
    assert m["start_seconds"] == 12.5
    assert m["youtube_url"] == "https://www.youtube.com/watch?v=alpha_vid_3&t=12s"
    assert m["quote"] == "蘋果這季財報很強,我會買"


async def test_stock_mentions_one_row_per_video_with_multiple_timestamps(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    app, client = api
    async with sessionmaker() as s:
        s.add(Channel(id="ch_m", title="ch_m", thumbnail_url="http://x/a.jpg",
                      uploads_playlist_id="UU_m"))
        s.add(Video(
            id="v_multi", channel_id="ch_m", title="multi",
            published_at=datetime.now(timezone.utc) - timedelta(hours=1),
            thumbnail_url="", duration_seconds=60, status=VideoStatus.analyzed,
        ))
        # same video mentioned three times, with inconsistent per-mention stance and no VideoStance row
        for sec, stance in ((10.0, Stance.buy), (20.0, Stance.buy), (30.0, Stance.sell)):
            s.add(Mention(video_id="v_multi", ticker="AMD", start_seconds=sec,
                          quote=f"q{sec}", stance=stance, reasoning="r"))
        await s.commit()

    resp = await client.get("/api/stocks/AMD/mentions")
    data = resp.json()["data"]
    assert len(data) == 1  # one video yields a single row
    row = data[0]
    assert [m["start_seconds"] for m in row["mentions"]] == [10.0, 20.0, 30.0]
    assert row["stance"] == "buy"  # with no VideoStance, take the per-mention majority vote
    assert row["channel_thumbnail"] == "http://x/a.jpg"


async def test_search_returns_results(api):
    app, client = api
    resp = await client.get("/api/stocks/search?q=apple")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert any(hit["ticker"] == "AAPL" for hit in body["data"])


async def test_search_rejects_empty_query(api):
    app, client = api
    resp = await client.get("/api/stocks/search?q=")
    assert resp.status_code == 422


async def test_search_rejects_whitespace_query(api):
    app, client = api
    resp = await client.get("/api/stocks/search?q=%20%20")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_financials_quarterly_returns_8(api):
    _, client = api
    res = await client.get("/api/stocks/AAPL/financials?period=quarterly")
    assert res.status_code == 200
    assert len(res.json()["data"]) == 8


@pytest.mark.asyncio
async def test_financials_annual_returns_5(api):
    _, client = api
    res = await client.get("/api/stocks/AAPL/financials?period=annual")
    assert res.status_code == 200
    assert len(res.json()["data"]) == 5


@pytest.mark.asyncio
async def test_financials_rejects_bad_period(api):
    _, client = api
    res = await client.get("/api/stocks/AAPL/financials?period=monthly")
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_financials_unknown_ticker(api):
    _, client = api
    res = await client.get("/api/stocks/ZZZZ/financials?period=annual")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_stance_summary_shape(api):
    _, client = await seed(api)
    res = await client.get("/api/stocks/AAPL/stance-summary")
    assert res.status_code == 200
    body = res.json()["data"]
    assert set(body.keys()) == {"buy", "neutral", "sell", "window_days", "channels", "buckets"}
    assert body["window_days"] == 90
    assert isinstance(body["buy"], int)
    assert isinstance(body["neutral"], int)
    assert isinstance(body["sell"], int)
    assert isinstance(body["channels"], list)
    assert isinstance(body["buckets"], list)


@pytest.mark.asyncio
async def test_stance_summary_unknown_ticker_returns_zero_counts(api):
    _, client = api
    res = await client.get("/api/stocks/ZZZZ/stance-summary")
    assert res.status_code == 200
    body = res.json()["data"]
    assert body == {
        "buy": 0, "neutral": 0, "sell": 0, "window_days": 90, "channels": [], "buckets": [],
    }


@pytest.mark.asyncio
async def test_stance_summary_aapl_has_at_least_one_stance(api):
    _, client = await seed(api)
    res = await client.get("/api/stocks/AAPL/stance-summary")
    body = res.json()["data"]
    assert body["buy"] + body["neutral"] + body["sell"] >= 1


@pytest.mark.asyncio
async def test_mentions_endpoint_returns_context_columns(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    app, client = api
    async with sessionmaker() as s:
        s.add(Channel(id="ch1", title="ch1", thumbnail_url="", uploads_playlist_id="UU"))
        s.add(Video(
            id="v_ctx", channel_id="ch1", title="t",
            published_at=datetime.now(timezone.utc) - timedelta(hours=1),
            thumbnail_url="", duration_seconds=60, status=VideoStatus.analyzed,
        ))
        s.add(Mention(
            video_id="v_ctx", ticker="AAPL", start_seconds=1.0,
            quote="q", stance=Stance.buy, reasoning="r",
            context_before="先前一句", context_after="後續一句",
            excerpt="前後合成的一整段原文",
        ))
        await s.commit()

    response = await client.get("/api/stocks/AAPL/mentions")
    assert response.status_code == 200
    rows = response.json()["data"]
    row = next(r for r in rows if r["video_id"] == "v_ctx")
    assert row["mentions"][0]["context_before"] == "先前一句"
    assert row["mentions"][0]["context_after"] == "後續一句"
    assert row["mentions"][0]["excerpt"] == "前後合成的一整段原文"


@pytest.mark.asyncio
async def test_trending_ties_broken_by_recency(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    _, client = api
    async with sessionmaker() as s:
        s.add(Channel(id="ch_t", title="ch_t", thumbnail_url="", uploads_playlist_id="UU_t"))
        now = datetime.now(timezone.utc)
        s.add(Video(id="v_old", channel_id="ch_t", title="old",
                    published_at=now - timedelta(days=10), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        for i in range(5):
            s.add(Mention(video_id="v_old", ticker="AAPL", start_seconds=float(i),
                          quote="q", stance=Stance.buy, reasoning="r"))
        s.add(Video(id="v_new", channel_id="ch_t", title="new",
                    published_at=now - timedelta(hours=1), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="v_new", ticker="NVDA", start_seconds=1.0,
                      quote="q", stance=Stance.buy, reasoning="r"))
        s.add(Video(id="v_stale", channel_id="ch_t", title="stale",
                    published_at=now - timedelta(days=80), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        for i in range(5):
            s.add(Mention(video_id="v_stale", ticker="TSLA", start_seconds=float(i),
                          quote="q", stance=Stance.buy, reasoning="r"))
        await s.commit()

    rows = (await client.get("/api/stocks/trending?limit=5")).json()["data"]
    # All single-channel → channel_count ties → ordered by most-recent mention
    assert [r["ticker"] for r in rows] == ["NVDA", "AAPL", "TSLA"]
    assert all(r["channel_count"] == 1 for r in rows)
    assert rows[1]["mention_count"] == 5  # AAPL still reports its mention total


@pytest.mark.asyncio
async def test_trending_ranks_by_distinct_channel_count(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    _, client = api
    async with sessionmaker() as s:
        now = datetime.now(timezone.utc)
        # 3 distinct channels each mention MSFT once
        for n in range(3):
            s.add(Channel(id=f"chm{n}", title=f"chm{n}", thumbnail_url="",
                          uploads_playlist_id=f"UUm{n}"))
            s.add(Video(id=f"vm{n}", channel_id=f"chm{n}", title="t",
                        published_at=now - timedelta(days=1), thumbnail_url="",
                        duration_seconds=60, status=VideoStatus.analyzed))
            s.add(Mention(video_id=f"vm{n}", ticker="MSFT", start_seconds=1.0,
                          quote="q", stance=Stance.buy, reasoning="r"))
        # 1 channel mentions GOOG 10 times (more mentions, fewer channels)
        s.add(Channel(id="ch_solo", title="solo", thumbnail_url="",
                      uploads_playlist_id="UUsolo"))
        s.add(Video(id="v_solo", channel_id="ch_solo", title="t",
                    published_at=now, thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        for i in range(10):
            s.add(Mention(video_id="v_solo", ticker="GOOG", start_seconds=float(i),
                          quote="q", stance=Stance.buy, reasoning="r"))
        await s.commit()

    rows = (await client.get("/api/stocks/trending?limit=5")).json()["data"]
    by = {r["ticker"]: r for r in rows}
    assert by["MSFT"]["channel_count"] == 3
    assert by["GOOG"]["channel_count"] == 1
    assert by["GOOG"]["mention_count"] == 10
    # 3 channels outranks 1 channel despite GOOG having more mentions
    assert rows.index(by["MSFT"]) < rows.index(by["GOOG"])


async def test_daily_candles_served_from_price_store(api):
    app, client = api
    resp = await client.get("/api/stocks/AAPL/candles?range=3m")
    body = resp.json()
    assert resp.status_code == 200 and body["success"]
    assert len(body["data"]) > 30
    # daily-bar time is a YYYY-MM-DD string
    assert all(isinstance(c["time"], str) for c in body["data"])
    # the second call goes straight to the DB (does not break)
    resp2 = await client.get("/api/stocks/AAPL/candles?range=3m")
    assert resp2.json()["data"] == body["data"]


async def test_intraday_candles_still_use_market_client(api):
    app, client = api
    resp = await client.get("/api/stocks/AAPL/candles?range=1d")
    body = resp.json()
    assert resp.status_code == 200 and body["success"]
    assert all(isinstance(c["time"], int) for c in body["data"])


async def test_analyst_endpoint_returns_targets(api):
    app, client = api
    resp = await client.get("/api/stocks/AAPL/analyst")
    body = resp.json()
    assert resp.status_code == 200 and body["success"]
    data = body["data"]
    assert data["target_mean"] is not None
    assert "strongBuy" in data["recommendations"]

    resp = await client.get("/api/stocks/ZZZZ/analyst")
    assert resp.json()["data"]["target_mean"] is None


async def test_stance_summary_accepts_long_window(api):
    app, client = api
    resp = await client.get("/api/stocks/AAPL/stance-summary?days=3650")
    assert resp.status_code == 200
    assert resp.json()["data"]["window_days"] == 3650


@pytest.mark.asyncio
async def test_stance_summary_counts_distinct_channels(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Stance, Video, VideoStance, VideoStatus

    _, client = api
    now = datetime.now(timezone.utc)
    async with sessionmaker() as s:
        # Channel A: two BUY videos on TSLA → must count once for buy
        s.add(Channel(id="cA", title="A", thumbnail_url="", uploads_playlist_id="UUA"))
        for i in range(2):
            s.add(Video(id=f"a{i}", channel_id="cA", title="t",
                        published_at=now - timedelta(days=1), thumbnail_url="",
                        duration_seconds=60, status=VideoStatus.analyzed))
            s.add(VideoStance(video_id=f"a{i}", ticker="TSLA",
                              stance=Stance.buy, summary="s"))
        # Channel B: one BUY + one SELL on TSLA → counts in BOTH buckets
        s.add(Channel(id="cB", title="B", thumbnail_url="", uploads_playlist_id="UUB"))
        s.add(Video(id="b0", channel_id="cB", title="t",
                    published_at=now - timedelta(days=1), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(VideoStance(video_id="b0", ticker="TSLA", stance=Stance.buy, summary="s"))
        s.add(Video(id="b1", channel_id="cB", title="t",
                    published_at=now - timedelta(days=1), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(VideoStance(video_id="b1", ticker="TSLA", stance=Stance.sell, summary="s"))
        await s.commit()

    body = (await client.get("/api/stocks/TSLA/stance-summary")).json()["data"]
    assert body["buy"] == 2     # channel A (once, despite 2 videos) + channel B
    assert body["sell"] == 1    # channel B
    assert body["neutral"] == 0
    # channels: distinct channels that had a stance on TSLA within the window (A and B, once each)
    assert {c["id"] for c in body["channels"]} == {"cA", "cB"}


@pytest.mark.asyncio
async def test_trending_includes_per_stance_channel_avatars(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    _, client = api
    now = datetime.now(timezone.utc)
    async with sessionmaker() as s:
        # 4 channels currently BULLISH on AMZN; distinct published_at so ordering is deterministic
        # cb0 is newest (days=2, hours=0), cb3 is oldest (days=2, hours=3)
        for n in range(4):
            s.add(Channel(id=f"cb{n}", title=f"Bull{n}", thumbnail_url=f"http://x/{n}.jpg",
                          uploads_playlist_id=f"UUb{n}"))
            s.add(Video(id=f"vb{n}", channel_id=f"cb{n}", title="t",
                        published_at=now - timedelta(days=2, hours=n), thumbnail_url="",
                        duration_seconds=60, status=VideoStatus.analyzed))
            s.add(Mention(video_id=f"vb{n}", ticker="AMZN", start_seconds=1.0,
                          quote="q", stance=Stance.buy, reasoning="r"))
        # channel cb0 ALSO has an OLDER sell mention → its latest stance is buy, so it
        # must count only in buy (proves most-recent-wins reduction + clean partition)
        s.add(Video(id="vb0_old", channel_id="cb0", title="t",
                    published_at=now - timedelta(days=9), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="vb0_old", ticker="AMZN", start_seconds=1.0,
                      quote="q", stance=Stance.sell, reasoning="r"))
        # 1 channel bearish
        s.add(Channel(id="cs", title="Bear", thumbnail_url="http://x/s.jpg",
                      uploads_playlist_id="UUs"))
        s.add(Video(id="vs", channel_id="cs", title="t",
                    published_at=now - timedelta(days=1), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="vs", ticker="AMZN", start_seconds=1.0,
                      quote="q", stance=Stance.sell, reasoning="r"))
        await s.commit()

    rows = (await client.get("/api/stocks/trending?limit=5")).json()["data"]
    amzn = next(r for r in rows if r["ticker"] == "AMZN")
    assert amzn["channel_count"] == 5
    st = amzn["stances"]
    assert st["buy"]["count"] == 4       # cb0 counted as buy (latest), not sell
    assert st["neutral"]["count"] == 0
    assert st["sell"]["count"] == 1
    assert st["buy"]["count"] + st["neutral"]["count"] + st["sell"]["count"] == amzn["channel_count"]
    assert len(st["buy"]["avatars"]) == 3
    assert st["buy"]["avatars"][0]["title"].startswith("Bull")
    assert st["buy"]["avatars"][0]["thumbnail_url"].startswith("http")
    # avatars are most-recent-first; cb0 (newest buy mention) leads
    assert st["buy"]["avatars"][0]["title"] == "Bull0"
    assert len(st["sell"]["avatars"]) == 1
    assert st["sell"]["avatars"][0]["title"] == "Bear"


@pytest.mark.asyncio
async def test_trending_count_days_independent_of_freshness(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    _, client = api
    now = datetime.now(timezone.utc)
    async with sessionmaker() as s:
        s.add(Channel(id="cc0", title="C0", thumbnail_url="http://x/0.jpg", uploads_playlist_id="UU0"))
        s.add(Channel(id="cc1", title="C1", thumbnail_url="http://x/1.jpg", uploads_playlist_id="UU1"))
        # NFLX: a fresh mention (2 days ago) by cc0 + an older mention (60 days ago) by cc1
        s.add(Video(id="nf_new", channel_id="cc0", title="t",
                    published_at=now - timedelta(days=2), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="nf_new", ticker="NFLX", start_seconds=1.0, quote="q",
                      stance=Stance.buy, reasoning="r"))
        s.add(Video(id="nf_old", channel_id="cc1", title="t",
                    published_at=now - timedelta(days=60), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="nf_old", ticker="NFLX", start_seconds=1.0, quote="q",
                      stance=Stance.buy, reasoning="r"))
        # ORCL: only an old mention (60 days ago) → NOT fresh in a 7-day window
        s.add(Video(id="or_old", channel_id="cc0", title="t",
                    published_at=now - timedelta(days=60), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="or_old", ticker="ORCL", start_seconds=1.0, quote="q",
                      stance=Stance.buy, reasoning="r"))
        await s.commit()

    # freshness=7d, count=90d: only NFLX is fresh; its channel_count counts BOTH channels (90d window)
    rows = (await client.get("/api/stocks/trending?days=7&count_days=90&limit=50")).json()["data"]
    by = {r["ticker"]: r for r in rows}
    assert "NFLX" in by and "ORCL" not in by          # ORCL filtered out by 7d freshness
    assert by["NFLX"]["channel_count"] == 2           # counted over the 90d window

    # freshness=7d, count=7d: NFLX still fresh, but only the 2-day-ago channel counts
    rows2 = (await client.get("/api/stocks/trending?days=7&count_days=7&limit=50")).json()["data"]
    by2 = {r["ticker"]: r for r in rows2}
    assert by2["NFLX"]["channel_count"] == 1


@pytest.mark.asyncio
async def test_trending_count_days_defaults_to_days(api, sessionmaker):
    # Omitting count_days must preserve the current behaviour (count window == days).
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    _, client = api
    now = datetime.now(timezone.utc)
    async with sessionmaker() as s:
        s.add(Channel(id="cd0", title="D0", thumbnail_url="", uploads_playlist_id="UUd0"))
        s.add(Video(id="d_v", channel_id="cd0", title="t",
                    published_at=now - timedelta(days=3), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="d_v", ticker="ADBE", start_seconds=1.0, quote="q",
                      stance=Stance.buy, reasoning="r"))
        await s.commit()
    rows = (await client.get("/api/stocks/trending?days=90&limit=50")).json()["data"]
    adbe = next(r for r in rows if r["ticker"] == "ADBE")
    assert adbe["channel_count"] == 1
    assert set(adbe["stances"].keys()) == {"buy", "neutral", "sell"}


@pytest.mark.asyncio
async def test_trending_fresh_but_outside_count_window(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    _, client = api
    now = datetime.now(timezone.utc)
    async with sessionmaker() as s:
        s.add(Channel(id="cg0", title="G0", thumbnail_url="", uploads_playlist_id="UUg0"))
        # SHOP mentioned 30 days ago: passes a 90d freshness gate, but a 7d count window is empty
        s.add(Video(id="g_v", channel_id="cg0", title="t",
                    published_at=now - timedelta(days=30), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="g_v", ticker="SHOP", start_seconds=1.0, quote="q",
                      stance=Stance.buy, reasoning="r"))
        await s.commit()

    rows = (await client.get("/api/stocks/trending?days=90&count_days=7&limit=50")).json()["data"]
    shop = next(r for r in rows if r["ticker"] == "SHOP")  # still included (fresh within 90d)
    assert shop["channel_count"] == 0          # no channels within the 7d count window
    assert shop["mention_count"] == 0
    assert shop["stances"]["buy"]["count"] == 0
    assert shop["last_mentioned_at"].startswith("20")  # from fresh_last, not None


@pytest.mark.asyncio
async def test_trending_includes_weekly_buckets(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    _, client = api
    now = datetime.now(timezone.utc)
    async with sessionmaker() as s:
        s.add(Channel(id="cbk", title="bk", thumbnail_url="", uploads_playlist_id="UUbk"))
        # one BUY this week, one SELL ~3 weeks ago, same channel
        s.add(Video(id="vbk_new", channel_id="cbk", title="t",
                    published_at=now - timedelta(days=1), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="vbk_new", ticker="ABNB", start_seconds=1.0,
                      quote="q", stance=Stance.buy, reasoning="r"))
        s.add(Video(id="vbk_old", channel_id="cbk", title="t",
                    published_at=now - timedelta(days=21), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="vbk_old", ticker="ABNB", start_seconds=1.0,
                      quote="q", stance=Stance.sell, reasoning="r"))
        await s.commit()

    rows = (await client.get("/api/stocks/trending?limit=50&days=90&count_days=90")).json()["data"]
    abnb = next(r for r in rows if r["ticker"] == "ABNB")
    assert len(abnb["buckets"]) == 12  # 90d -> 12 weekly buckets
    b0 = abnb["buckets"][0]
    assert set(b0.keys()) == {"start", "end", "granularity", "buy", "neutral", "sell"}
    assert all(b["granularity"] == "week" for b in abnb["buckets"])
    # newest bucket has the BUY, an earlier bucket has the SELL
    assert abnb["buckets"][-1]["buy"] == 1
    assert sum(b["sell"] for b in abnb["buckets"]) == 1


@pytest.mark.asyncio
async def test_stance_summary_includes_buckets_from_mentions(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    _, client = api
    now = datetime.now(timezone.utc)
    async with sessionmaker() as s:
        s.add(Channel(id="csb", title="sb", thumbnail_url="", uploads_playlist_id="UUsb"))
        s.add(Video(id="vsb", channel_id="csb", title="t",
                    published_at=now - timedelta(days=2), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="vsb", ticker="SHOP", start_seconds=1.0,
                      quote="q", stance=Stance.buy, reasoning="r"))
        await s.commit()

    body = (await client.get("/api/stocks/SHOP/stance-summary?days=90")).json()["data"]
    assert len(body["buckets"]) == 12  # 90d -> 12 weekly buckets
    assert all(b["granularity"] == "week" for b in body["buckets"])
    assert sum(b["buy"] for b in body["buckets"]) == 1
