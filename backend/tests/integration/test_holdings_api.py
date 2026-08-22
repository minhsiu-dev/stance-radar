import pytest

pytestmark = pytest.mark.asyncio


async def test_add_list_and_delete(api):
    _, client = api
    assert (await client.get("/api/holdings")).json()["data"] == []

    resp = await client.post("/api/holdings", json={"tickers": "aapl, MSFT\nnvda"})
    assert resp.status_code == 200
    assert resp.json()["data"]["added"] == ["AAPL", "MSFT", "NVDA"]

    rows = (await client.get("/api/holdings")).json()["data"]
    assert [r["ticker"] for r in rows] == ["AAPL", "MSFT", "NVDA"]
    assert all(r["added_at"] for r in rows)

    assert (await client.delete("/api/holdings/MSFT")).status_code == 200
    rows = (await client.get("/api/holdings")).json()["data"]
    assert [r["ticker"] for r in rows] == ["AAPL", "NVDA"]


async def test_adding_an_existing_ticker_is_idempotent(api):
    _, client = api
    await client.post("/api/holdings", json={"tickers": "AAPL"})
    resp = await client.post("/api/holdings", json={"tickers": "AAPL GOOG"})
    body = resp.json()["data"]
    assert body["added"] == ["GOOG"]
    assert body["skipped"] == ["AAPL"]
    rows = (await client.get("/api/holdings")).json()["data"]
    assert [r["ticker"] for r in rows] == ["AAPL", "GOOG"]


async def test_empty_input_is_rejected(api):
    _, client = api
    assert (await client.post("/api/holdings", json={"tickers": "   "})).status_code == 422


async def test_deleting_an_absent_ticker_404s(api):
    _, client = api
    assert (await client.delete("/api/holdings/NOPE")).status_code == 404


async def test_reads_and_writes_are_admin_gated(locked_api):
    """Holdings are the only genuinely personal data here and the site is publicly
    reachable, so unlike every other read endpoint this one is locked too."""
    _, client = locked_api
    assert (await client.get("/api/holdings")).status_code == 401
    assert (await client.post("/api/holdings", json={"tickers": "AAPL"})).status_code == 401
    assert (await client.delete("/api/holdings/AAPL")).status_code == 401


async def test_denied_when_no_admin_password_is_configured(no_admin_api):
    _, client = no_admin_api
    assert (await client.get("/api/holdings")).status_code == 401
