from tests.conftest import wait_refresh


async def seed(api) -> tuple:
    app, client = api
    await client.post(
        "/api/channels", json={"channel_ids": "UC_fake_alpha UC_fake_beta"}
    )
    await wait_refresh(app)
    return app, client


async def test_feed_lists_videos_newest_first_with_stances(api):
    app, client = await seed(api)
    resp = await client.get("/api/feed")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 6
    items = data["items"]
    assert [v["video_id"] for v in items][:2] == ["alpha_vid_3", "beta_vid_3"]

    newest = items[0]
    assert newest["status"] == "analyzed"
    assert newest["channel"]["title"] == "頻道 Alpha"
    assert newest["stances"] == [
        {"ticker": "AAPL", "stance": "buy", "summary": "財報強勁,整體看多 AAPL"}
    ]

    no_transcript = next(v for v in items if v["video_id"] == "beta_vid_1")
    assert no_transcript["status"] == "no_transcript"
    assert no_transcript["stances"] == []


async def test_feed_pagination(api):
    app, client = await seed(api)
    resp = await client.get("/api/feed", params={"page": 2, "page_size": 4})
    data = resp.json()["data"]
    assert data["total"] == 6
    assert len(data["items"]) == 2
