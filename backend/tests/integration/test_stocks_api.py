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
    # AAPL 2 筆 mention、NVDA 2 筆、TSLA 1 筆;依次數降冪
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
    # 預設 1y → 現在走 PriceStore,日數由日曆天數決定(250–270 個交易日)
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
    assert [row["video_id"] for row in data] == ["beta_vid_2", "alpha_vid_3"]  # 舊→新
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
    assert [row["video_id"] for row in data] == ["alpha_vid_3", "beta_vid_2"]  # 新→舊
    first = data[0]
    # 影片層級欄位
    assert first["stance"] == "buy"  # 來自 VideoStance(整部影片總體立場)
    assert first["summary"] == "財報強勁,整體看多 AAPL"
    assert first["channel_thumbnail"] is not None
    assert first["youtube_url"] == "https://www.youtube.com/watch?v=alpha_vid_3"
    # 巢狀 mentions:每次提及一筆,含 deep link
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
        # 同一部影片三次提及,逐筆 stance 不一致,且沒有 VideoStance 列
        for sec, stance in ((10.0, Stance.buy), (20.0, Stance.buy), (30.0, Stance.sell)):
            s.add(Mention(video_id="v_multi", ticker="AMD", start_seconds=sec,
                          quote=f"q{sec}", stance=stance, reasoning="r"))
        await s.commit()

    resp = await client.get("/api/stocks/AMD/mentions")
    data = resp.json()["data"]
    assert len(data) == 1  # 一部影片只有一列
    row = data[0]
    assert [m["start_seconds"] for m in row["mentions"]] == [10.0, 20.0, 30.0]
    assert row["stance"] == "buy"  # 無 VideoStance 時取逐筆多數決
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
    assert set(body.keys()) == {"buy", "neutral", "sell", "window_days"}
    assert body["window_days"] == 90
    assert isinstance(body["buy"], int)
    assert isinstance(body["neutral"], int)
    assert isinstance(body["sell"], int)


@pytest.mark.asyncio
async def test_stance_summary_unknown_ticker_returns_zero_counts(api):
    _, client = api
    res = await client.get("/api/stocks/ZZZZ/stance-summary")
    assert res.status_code == 200
    body = res.json()["data"]
    assert body == {"buy": 0, "neutral": 0, "sell": 0, "window_days": 90}


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
        ))
        await s.commit()

    response = await client.get("/api/stocks/AAPL/mentions")
    assert response.status_code == 200
    rows = response.json()["data"]
    row = next(r for r in rows if r["video_id"] == "v_ctx")
    assert row["mentions"][0]["context_before"] == "先前一句"
    assert row["mentions"][0]["context_after"] == "後續一句"


@pytest.mark.asyncio
async def test_trending_uses_recency_weighted_score(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Mention, Stance, Video, VideoStatus

    _, client = api
    async with sessionmaker() as s:
        s.add(Channel(id="ch_t", title="ch_t", thumbnail_url="", uploads_playlist_id="UU_t"))
        now = datetime.now(timezone.utc)
        # AAPL:10 天前被密集提及 5 次(score ≈ 5 × 0.5^(10/7) ≈ 1.86)
        s.add(Video(id="v_old", channel_id="ch_t", title="old",
                    published_at=now - timedelta(days=10), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        for i in range(5):
            s.add(Mention(video_id="v_old", ticker="AAPL", start_seconds=float(i),
                          quote="q", stance=Stance.buy, reasoning="r"))
        # NVDA:1 小時前被提 1 次(score ≈ 1.0)→ 不應僅因較新就贏過 AAPL
        s.add(Video(id="v_new", channel_id="ch_t", title="new",
                    published_at=now - timedelta(hours=1), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        s.add(Mention(video_id="v_new", ticker="NVDA", start_seconds=1.0,
                      quote="q", stance=Stance.buy, reasoning="r"))
        # TSLA:80 天前被提 5 次,熱度幾乎衰減光(score ≈ 0.02)→ 墊底
        s.add(Video(id="v_stale", channel_id="ch_t", title="stale",
                    published_at=now - timedelta(days=80), thumbnail_url="",
                    duration_seconds=60, status=VideoStatus.analyzed))
        for i in range(5):
            s.add(Mention(video_id="v_stale", ticker="TSLA", start_seconds=float(i),
                          quote="q", stance=Stance.buy, reasoning="r"))
        await s.commit()

    response = await client.get("/api/stocks/trending?limit=5")
    assert response.status_code == 200
    rows = response.json()["data"]
    tickers = [row["ticker"] for row in rows]
    # 密集且不算舊 > 單次新鮮 > 大量但過期
    assert tickers == ["AAPL", "NVDA", "TSLA"]
    assert rows[0]["mention_count"] == 5
    assert rows[0]["score"] > rows[1]["score"] > rows[2]["score"]


async def test_daily_candles_served_from_price_store(api):
    app, client = api
    resp = await client.get("/api/stocks/AAPL/candles?range=3m")
    body = resp.json()
    assert resp.status_code == 200 and body["success"]
    assert len(body["data"]) > 30
    # 日 K time 是 YYYY-MM-DD 字串
    assert all(isinstance(c["time"], str) for c in body["data"])
    # 第二次呼叫直接走 DB(不會壞)
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
