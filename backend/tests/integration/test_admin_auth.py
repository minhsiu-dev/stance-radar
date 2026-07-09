PW = "hunter2"


async def test_session_reports_enabled_and_locked(locked_api):
    _, client = locked_api
    assert (await client.get("/api/admin/session")).json()["data"] == {
        "enabled": True, "authenticated": False,
    }


async def test_wrong_password_stays_locked(locked_api):
    _, client = locked_api
    r = await client.post("/api/admin/unlock", json={"password": "nope"})
    assert r.status_code == 401 and r.json()["error"] == "Wrong password"
    assert "set-cookie" not in r.headers


async def test_unlock_then_lock_roundtrip(locked_api):
    _, client = locked_api
    r = await client.post("/api/admin/unlock", json={"password": PW})
    assert r.status_code == 200 and r.json()["data"] == {"authenticated": True}
    assert (await client.get("/api/admin/session")).json()["data"] == {
        "enabled": True, "authenticated": True,
    }
    assert (await client.post("/api/admin/lock")).json()["data"] == {"authenticated": False}
    assert (await client.get("/api/admin/session")).json()["data"]["authenticated"] is False


async def test_deny_all_when_password_unset(no_admin_api):
    _, client = no_admin_api
    assert (await client.get("/api/admin/session")).json()["data"] == {
        "enabled": False, "authenticated": False,
    }
    r = await client.post("/api/admin/unlock", json={"password": "anything"})
    assert r.status_code == 401
    assert "set-cookie" not in r.headers
