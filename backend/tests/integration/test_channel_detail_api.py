from tests.conftest import wait_refresh


async def seed_two_phase(api) -> tuple:
    app, client = api
    await client.post(
        "/api/channels", json={"channel_ids": "UC_fake_alpha UC_fake_beta"}
    )
    await wait_refresh(app)
    # 只分析 alpha 的兩部,略過一部;beta 維持 discovered
    await client.post("/api/videos/analyze", json={
        "video_ids": ["alpha_vid_3", "alpha_vid_2"],
    })
    await wait_refresh(app)
    await client.post("/api/videos/skip", json={"video_ids": ["alpha_vid_1"]})
    return app, client


async def test_channel_detail_stats(api):
    app, client = await seed_two_phase(api)
    resp = await client.get("/api/channels/UC_fake_alpha")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["id"] == "UC_fake_alpha"
    assert data["title"] == "頻道 Alpha"
    assert data["status_counts"] == {"analyzed": 2, "skipped": 1}
    # alpha_vid_3 → AAPL buy(fake adapter 固定資料)
    tickers = {t["ticker"]: t for t in data["top_tickers"]}
    assert "AAPL" in tickers
    assert tickers["AAPL"]["buy"] >= 1


async def test_channel_detail_404(api):
    app, client = api
    resp = await client.get("/api/channels/UC_nope")
    assert resp.status_code == 404


async def test_channel_videos_with_status_filter(api):
    app, client = await seed_two_phase(api)
    resp = await client.get("/api/channels/UC_fake_alpha/videos")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 3
    assert [v["id"] for v in data["items"]] == [
        "alpha_vid_3", "alpha_vid_2", "alpha_vid_1",
    ]
    analyzed = data["items"][0]
    assert analyzed["status"] == "analyzed"
    assert analyzed["stances"][0]["ticker"] == "AAPL"

    resp = await client.get(
        "/api/channels/UC_fake_alpha/videos", params={"status": "skipped"}
    )
    data = resp.json()["data"]
    assert data["total"] == 1
    assert data["items"][0]["id"] == "alpha_vid_1"

    resp = await client.get(
        "/api/channels/UC_fake_alpha/videos", params={"status": "bogus"}
    )
    assert resp.status_code == 400

    resp = await client.get("/api/channels/UC_nope/videos")
    assert resp.status_code == 404


async def test_channel_list_includes_video_counts(api):
    app, client = await seed_two_phase(api)
    resp = await client.get("/api/channels")
    by_id = {c["id"]: c for c in resp.json()["data"]}
    assert by_id["UC_fake_alpha"]["video_counts"] == {"analyzed": 2, "skipped": 1}
    assert by_id["UC_fake_beta"]["video_counts"] == {"discovered": 3}


async def test_top_tickers_include_latest_stance(api):
    # seed_two_phase 分析了 alpha_vid_3 (AAPL buy, 2026-06-08)
    # 以及 alpha_vid_2 (NVDA sell, 2026-05-25);alpha_vid_1 被 skip
    app, client = await seed_two_phase(api)
    resp = await client.get("/api/channels/UC_fake_alpha")
    assert resp.status_code == 200
    data = resp.json()["data"]

    tickers = {t["ticker"]: t for t in data["top_tickers"]}
    assert "AAPL" in tickers
    aapl = tickers["AAPL"]
    assert aapl["latest_stance"] == "buy"
    assert aapl["latest_date"] == "2026-06-08"

    assert "NVDA" in tickers
    nvda = tickers["NVDA"]
    assert nvda["latest_stance"] == "sell"
    assert nvda["latest_date"] == "2026-05-25"
