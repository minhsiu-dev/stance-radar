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


async def test_write_endpoints_401_when_locked(locked_api):
    _, client = locked_api
    cases = [
        ("post", "/api/channels", {"channel_ids": "UCabc"}),
        ("post", "/api/refresh", None),
        ("post", "/api/videos/analyze", {"video_ids": ["v1"]}),
        ("post", "/api/videos/skip", {"video_ids": ["v1"]}),
        ("patch", "/api/channels/UCabc", {"auto_analyze": True}),
        ("post", "/api/channels/UCabc/load-older", None),
        ("delete", "/api/channels/UCabc", None),
    ]
    for method, path, body in cases:
        r = await getattr(client, method)(path, **({"json": body} if body else {}))
        assert r.status_code == 401, f"{method} {path} -> {r.status_code}"
        assert r.json()["error"] == "Admin locked", path


async def test_write_endpoints_allowed_after_unlock(locked_api):
    _, client = locked_api
    await client.post("/api/admin/unlock", json={"password": PW})
    # refresh is the cheapest write with no path params / preconditions
    assert (await client.post("/api/refresh")).status_code == 200


async def test_write_endpoints_401_when_password_unset(no_admin_api):
    _, client = no_admin_api
    assert (await client.post("/api/refresh")).status_code == 401
    assert (await client.post("/api/channels", json={"channel_ids": "UCabc"})).status_code == 401
