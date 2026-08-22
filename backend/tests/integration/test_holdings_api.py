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
    resp = await client.delete("/api/holdings/NOPE")
    assert resp.status_code == 404
    # Body, not just status: FastAPI's own unmatched-route 404 ({"detail": "Not Found"}) would
    # also satisfy a status-only assertion, so this has to check the handler's fail() envelope,
    # which is the only path that can produce this message.
    assert resp.json()["error"] == "NOPE is not in your holdings"


async def test_overlong_ticker_is_rejected_and_nothing_is_committed(api):
    _, client = api
    resp = await client.post(
        "/api/holdings", json={"tickers": "AAPL, THISTICKERISWAYTOOLONG"}
    )
    assert resp.status_code == 422
    assert "THISTICKERISWAYTOOLONG" in resp.json()["error"]
    # Whole request rejected, not partially applied: AAPL (valid) must not have been committed.
    rows = (await client.get("/api/holdings")).json()["data"]
    assert rows == []


async def test_too_many_tickers_in_one_request_is_rejected(api):
    _, client = api
    tickers = " ".join(f"T{i}" for i in range(201))
    resp = await client.post("/api/holdings", json={"tickers": tickers})
    assert resp.status_code == 422
    assert "too many" in resp.json()["error"].lower()
    rows = (await client.get("/api/holdings")).json()["data"]
    assert rows == []


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
