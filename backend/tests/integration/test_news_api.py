async def test_news_falls_back_to_market_etfs_without_holdings(api):
    app, client = api
    resp = await client.get("/api/news")
    data = resp.json()["data"]
    assert data["scope"] == "general"
    assert {n["ticker"] for n in data["items"]} <= {"VOO", "QQQ"}
    assert len(data["items"]) > 0


async def test_news_uses_holdings_when_present(api):
    app, client = api
    await client.post("/api/portfolio/transactions", json={
        "ticker": "AAPL", "side": "buy", "shares": 1, "price": 100,
        "executed_on": "2026-01-15",
    })
    resp = await client.get("/api/news")
    data = resp.json()["data"]
    assert data["scope"] == "holdings"
    assert {n["ticker"] for n in data["items"]} == {"AAPL"}
    # 依發布時間新到舊
    times = [n["published_at"] for n in data["items"]]
    assert times == sorted(times, reverse=True)
