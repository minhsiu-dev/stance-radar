async def add_tx(client, **overrides):
    payload = {
        "ticker": "AAPL", "side": "buy", "shares": 10, "price": 100,
        "executed_on": "2026-01-15",
    }
    payload.update(overrides)
    return await client.post("/api/portfolio/transactions", json=payload)


async def test_transaction_crud_and_holdings(api):
    app, client = api
    resp = await add_tx(client)
    assert resp.status_code == 200 and resp.json()["success"]
    tx_id = resp.json()["data"]["id"]

    resp = await client.get("/api/portfolio/transactions")
    assert [t["id"] for t in resp.json()["data"]] == [tx_id]

    resp = await client.get("/api/portfolio/holdings")
    data = resp.json()["data"]
    assert len(data["holdings"]) == 1
    h = data["holdings"][0]
    assert h["ticker"] == "AAPL" and h["shares"] == 10 and h["avg_cost"] == 100
    assert h["price"] is not None and h["market_value"] is not None
    assert data["totals"]["cost_basis"] == 1000

    resp = await client.delete(f"/api/portfolio/transactions/{tx_id}")
    assert resp.json()["success"]
    resp = await client.get("/api/portfolio/holdings")
    assert resp.json()["data"]["holdings"] == []


async def test_unknown_ticker_rejected(api):
    app, client = api
    resp = await add_tx(client, ticker="ZZZZ")
    assert resp.status_code == 422


async def test_oversell_rejected(api):
    app, client = api
    await add_tx(client, shares=5)
    resp = await add_tx(client, side="sell", shares=6, executed_on="2026-02-01")
    assert resp.status_code == 422


async def test_delete_that_breaks_later_sell_rejected(api):
    app, client = api
    buy = await add_tx(client, shares=10)
    sell = await add_tx(client, side="sell", shares=8, executed_on="2026-03-01")
    assert sell.status_code == 200
    resp = await client.delete(
        f"/api/portfolio/transactions/{buy.json()['data']['id']}"
    )
    assert resp.status_code == 422


async def test_performance_summary_and_range(api):
    app, client = api
    resp = await client.get("/api/portfolio/performance/summary")
    data = resp.json()["data"]
    assert data["portfolio"] is None  # 空持股
    assert "1y" in data["voo"]["changes"]

    await add_tx(client)
    resp = await client.get("/api/portfolio/performance/summary")
    data = resp.json()["data"]
    assert data["portfolio"]["total_value"] > 0
    assert set(data["ranges"]) == {"1d", "5d", "1m", "3m", "6m", "ytd", "1y"}

    resp = await client.get("/api/portfolio/performance?range=3m")
    data = resp.json()["data"]
    assert data["portfolio"]["series"][0]["value"] == 100.0
    assert data["voo"]["series"][0]["value"] == 100.0
    # 三條序列起點對齊
    assert data["voo"]["series"][0]["date"] == data["portfolio"]["series"][0]["date"]

    resp = await client.get("/api/portfolio/performance?range=1d")
    data = resp.json()["data"]
    assert data["portfolio"]["series"] is None

    resp = await client.get("/api/portfolio/performance?range=bogus")
    assert resp.status_code == 422
