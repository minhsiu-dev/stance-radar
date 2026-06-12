import pytest

from tests.conftest import wait_refresh


async def seed(api) -> tuple:
    app, client = api
    await client.post(
        "/api/channels", json={"channel_ids": "UC_fake_alpha UC_fake_beta"}
    )
    await wait_refresh(app)
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
    data = resp.json()["data"]
    assert len(data) == 260  # 預設 1y
    assert set(data[0]) == {"date", "open", "high", "low", "close", "volume"}

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
    }


async def test_stock_mentions_descending_with_deep_links(api):
    app, client = await seed(api)
    resp = await client.get("/api/stocks/AAPL/mentions")
    data = resp.json()["data"]
    assert [row["video_id"] for row in data] == ["alpha_vid_3", "beta_vid_2"]  # 新→舊
    first = data[0]
    assert first["start_seconds"] == 12.5
    assert first["youtube_url"] == "https://www.youtube.com/watch?v=alpha_vid_3&t=12s"
    assert first["stance"] == "buy"
    assert first["quote"] == "蘋果這季財報很強,我會買"


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
