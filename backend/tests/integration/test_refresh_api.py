from tests.conftest import wait_refresh


async def test_jobs_current_204_when_no_jobs(api):
    app, client = api
    resp = await client.get("/api/jobs/current")
    assert resp.status_code == 204


async def test_trigger_refresh_and_poll_until_done(api):
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})

    resp = await client.get("/api/jobs/current")
    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["status"] == "running"
    assert body["kind"] == "discover"

    await wait_refresh(app)
    resp = await client.get("/api/jobs/current")
    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["status"] == "done"
    assert body["finished_at"] is not None
    assert body["progress"]["discovered"] == 3  # 只探索,不分析


async def test_double_trigger_returns_same_job(api):
    import asyncio

    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)  # 先讓新增頻道觸發的 job 跑完

    # 把 discover 卡在 list_new_uploads,確保第二次 POST 時 job 一定還在跑
    youtube = app.state.runner._deps.youtube
    original = youtube.list_new_uploads
    gate = asyncio.Event()

    async def gated(*args, **kwargs):
        await gate.wait()
        return await original(*args, **kwargs)

    youtube.list_new_uploads = gated
    try:
        first = await client.post("/api/refresh")
        second = await client.post("/api/refresh")
    finally:
        gate.set()
        youtube.list_new_uploads = original
    assert first.json()["data"]["job_id"] == second.json()["data"]["job_id"]
    assert second.json()["data"]["created"] is False
    await wait_refresh(app)
