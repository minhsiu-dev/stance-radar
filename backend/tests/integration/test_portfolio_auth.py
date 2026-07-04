PW = "hunter2"


async def add_tx(client, **overrides):
    payload = {
        "ticker": "AAPL", "side": "buy", "shares": 10, "price": 100,
        "executed_on": "2026-01-15",
    }
    payload.update(overrides)
    return await client.post("/api/portfolio/transactions", json=payload)


async def test_gated_endpoints_401_without_unlock(locked_api):
    _, client = locked_api
    assert (await client.get("/api/portfolio/session")).json()["data"] == {
        "enabled": True, "authenticated": False,
    }
    for path in [
        "/api/portfolio/holdings",
        "/api/portfolio/transactions",
        "/api/portfolio/cash",
        "/api/portfolio/performance?range=1m",
    ]:
        r = await client.get(path)
        assert r.status_code == 401, path
        assert r.json() == {"success": False, "data": None, "error": "Portfolio is locked"}


async def test_gated_write_endpoints_401_without_unlock(locked_api):
    _, client = locked_api
    r = await client.post("/api/portfolio/transactions", json={
        "ticker": "AAPL", "side": "buy", "shares": 10, "price": 100,
        "executed_on": "2026-01-15",
    })
    assert r.status_code == 401
    assert (await client.put("/api/portfolio/cash", json={"amount": 100})).status_code == 401
    assert (await client.delete("/api/portfolio/transactions/does-not-exist")).status_code == 401


async def test_wrong_password_stays_locked(locked_api):
    _, client = locked_api
    r = await client.post("/api/portfolio/unlock", json={"password": "nope"})
    assert r.status_code == 401 and r.json()["error"] == "Wrong password"
    assert "set-cookie" not in r.headers
    assert (await client.get("/api/portfolio/holdings")).status_code == 401


async def test_unlock_grants_access_then_lock_revokes(locked_api):
    _, client = locked_api
    r = await client.post("/api/portfolio/unlock", json={"password": PW})
    assert r.status_code == 200 and r.json()["data"] == {"authenticated": True}
    assert (await client.get("/api/portfolio/holdings")).status_code == 200
    assert (await client.get("/api/portfolio/cash")).status_code == 200
    assert (await client.get("/api/portfolio/performance?range=1m")).status_code == 200
    assert (await client.get("/api/portfolio/session")).json()["data"] == {
        "enabled": True, "authenticated": True,
    }
    assert (await client.post("/api/portfolio/lock")).json()["data"] == {"authenticated": False}
    assert (await client.get("/api/portfolio/holdings")).status_code == 401


async def test_summary_hides_portfolio_until_unlocked(locked_api):
    _, client = locked_api
    await client.post("/api/portfolio/unlock", json={"password": PW})
    await add_tx(client)
    await client.post("/api/portfolio/lock")
    data = (await client.get("/api/portfolio/performance/summary")).json()["data"]
    assert data["portfolio"] is None        # gated
    assert "1y" in data["voo"]["changes"]   # benchmarks stay public
    await client.post("/api/portfolio/unlock", json={"password": PW})
    data = (await client.get("/api/portfolio/performance/summary")).json()["data"]
    assert data["portfolio"]["total_value"] > 0


async def test_feature_disabled_leaves_endpoints_open(api):
    _, client = api  # no PORTFOLIO_PASSWORD -> feature off
    assert (await client.get("/api/portfolio/holdings")).status_code == 200
    assert (await client.get("/api/portfolio/session")).json()["data"] == {
        "enabled": False, "authenticated": True,
    }


async def test_unlock_is_noop_when_feature_disabled(api):
    _, client = api
    r = await client.post("/api/portfolio/unlock", json={"password": "anything"})
    assert r.status_code == 200 and r.json()["data"] == {"authenticated": True}
    assert "set-cookie" not in r.headers
