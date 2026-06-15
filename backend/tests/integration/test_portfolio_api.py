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
    assert data["portfolio"] is None  # empty holdings
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
    # the three series share the same start point
    assert data["voo"]["series"][0]["date"] == data["portfolio"]["series"][0]["date"]

    resp = await client.get("/api/portfolio/performance?range=1d")
    data = resp.json()["data"]
    assert data["portfolio"]["series"] is None

    resp = await client.get("/api/portfolio/performance?range=bogus")
    assert resp.status_code == 422


async def test_holdings_all_quotes_failed_degrades_to_null_totals(api):
    app, client = api
    await add_tx(client)

    class DeadMarket:
        async def get_summary(self, ticker):
            raise RuntimeError("quotes down")

    app.state.market = DeadMarket()
    resp = await client.get("/api/portfolio/holdings")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["holdings"][0]["price"] is None
    assert data["holdings"][0]["market_value"] is None
    assert data["totals"]["market_value"] is None
    assert data["totals"]["unrealized_pl"] is None
    assert data["totals"]["cost_basis"] == 1000


async def test_one_day_change_treats_missing_change_as_flat(api):
    from app.market.client import StockSummary

    app, client = api
    await add_tx(client)

    class FlatMarket:
        async def get_summary(self, ticker):
            return StockSummary(
                ticker=ticker, name=ticker, price=100.0, change=None,
                change_percent=None, market_cap=None, pe_ratio=None,
                forward_pe=None, eps=None, week52_high=None, week52_low=None,
                volume=None, dividend_yield=None,
            )

    app.state.market = FlatMarket()
    resp = await client.get("/api/portfolio/performance?range=1d")
    data = resp.json()["data"]
    # change=None treated as 0 -> portfolio 1d change is 0%
    assert data["portfolio"]["change_percent"] == 0.0


async def test_same_day_transactions_do_not_crash_validation(api):
    """Regression: a candidate transaction's created_at is still None at validation
    time (the column default only takes effect on INSERT), so sorting it against an
    existing same-day transaction raised TypeError -> 500."""
    app, client = api
    assert (await add_tx(client, ticker="QQQ", executed_on="2026-01-01")).status_code == 200
    resp = await add_tx(client, ticker="VOO", executed_on="2026-01-01")
    assert resp.status_code == 200 and resp.json()["success"]
    # a same-day sell after the buy (sorted later by created_at) must also pass validation
    resp = await add_tx(
        client, ticker="VOO", side="sell", shares=5, executed_on="2026-01-01"
    )
    assert resp.status_code == 200 and resp.json()["success"]


async def test_cash_defaults_to_zero(api):
    _, client = api
    resp = await client.get("/api/portfolio/cash")
    assert resp.status_code == 200
    assert resp.json()["data"]["amount"] == 0


async def test_put_then_get_cash(api):
    _, client = api
    put = await client.put("/api/portfolio/cash", json={"amount": 5000})
    assert put.status_code == 200
    assert put.json()["data"]["amount"] == 5000
    got = await client.get("/api/portfolio/cash")
    assert got.json()["data"]["amount"] == 5000


async def test_put_negative_cash_rejected(api):
    _, client = api
    resp = await client.put("/api/portfolio/cash", json={"amount": -1})
    assert resp.status_code == 400


async def test_holdings_includes_cash_in_totals_and_weights(api):
    _, client = api
    await client.post("/api/portfolio/transactions", json={
        "ticker": "AAPL", "side": "buy", "shares": 10, "price": 100,
        "executed_on": "2026-01-02",
    })
    await client.put("/api/portfolio/cash", json={"amount": 1000})
    data = (await client.get("/api/portfolio/holdings")).json()["data"]
    totals = data["totals"]
    assert totals["cash"] == 1000
    assert totals["total_value"] == round(totals["market_value"] + 1000, 2)
    hold_w = sum(h["weight"] for h in data["holdings"] if h["weight"] is not None)
    assert totals["cash_weight"] is not None
    assert abs(hold_w + totals["cash_weight"] - 100) < 0.2


async def test_holdings_zero_cash_unchanged(api):
    _, client = api
    await client.post("/api/portfolio/transactions", json={
        "ticker": "AAPL", "side": "buy", "shares": 10, "price": 100,
        "executed_on": "2026-01-02",
    })
    totals = (await client.get("/api/portfolio/holdings")).json()["data"]["totals"]
    assert totals["cash"] == 0
    assert totals["total_value"] == totals["market_value"]


async def test_performance_summary_total_value_includes_cash(api):
    _, client = api
    await client.post("/api/portfolio/transactions", json={
        "ticker": "AAPL", "side": "buy", "shares": 10, "price": 100,
        "executed_on": "2026-01-02",
    })
    base = (await client.get("/api/portfolio/performance/summary")).json()["data"]
    base_tv = base["portfolio"]["total_value"]
    await client.put("/api/portfolio/cash", json={"amount": 2000})
    after = (await client.get("/api/portfolio/performance/summary")).json()["data"]
    assert after["portfolio"]["total_value"] == round(base_tv + 2000, 2)
