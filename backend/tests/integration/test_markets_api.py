async def test_benchmarks_returns_voo_qqq_vt_with_changes(api):
    _, client = api
    resp = await client.get("/api/markets/benchmarks")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["ranges"] == ["1d", "5d", "1m", "3m", "6m", "ytd", "1y"]
    tickers = [item["ticker"] for item in data["items"]]
    assert tickers == ["VOO", "QQQ", "VT"]
    for item in data["items"]:
        # fake adapters supply price + daily history for all three tickers
        assert item["price"] is not None
        assert item["changes"]["1d"] is not None
        assert item["changes"]["1m"] is not None
