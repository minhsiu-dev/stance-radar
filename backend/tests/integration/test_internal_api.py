async def test_internal_ticker_exists_endpoint(api):
    _app, client = api
    resp = await client.get("/api/internal/tickers/AAPL/exists")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["exists"] is True


async def test_internal_ticker_exists_is_readable_without_admin(no_admin_api):
    """The worker has no admin cookie; this read must not sit behind the write lock."""
    _app, client = no_admin_api
    resp = await client.get("/api/internal/tickers/AAPL/exists")
    assert resp.status_code == 200
