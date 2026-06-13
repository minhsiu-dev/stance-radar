from tests.conftest import wait_refresh


async def seed(api) -> tuple:
    app, client = api
    await client.post(
        "/api/channels", json={"channel_ids": "UC_fake_alpha UC_fake_beta"}
    )
    await wait_refresh(app)  # discover
    discovered = (await client.get(
        "/api/videos", params={"status": "discovered"}
    )).json()["data"]
    video_ids = [v["id"] for g in discovered["groups"] for v in g["videos"]]
    await client.post("/api/videos/analyze", json={"video_ids": video_ids})
    await wait_refresh(app)  # analyze
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
        {
            "ticker": "AAPL",
            "stance": "buy",
            "summary": "財報強勁,整體看多 AAPL",
            "confidence": "high",
        }
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


async def test_feed_holdings_only_filters_by_held_tickers(api):
    app, client = await seed(api)

    # No portfolio holdings yet → holdings_only returns empty
    resp = await client.get("/api/feed", params={"holdings_only": "true"})
    assert resp.status_code == 200
    assert resp.json()["data"]["items"] == []

    # Buy AAPL → holdings_only should return only AAPL-stance videos
    resp = await client.post(
        "/api/portfolio/transactions",
        json={"ticker": "AAPL", "side": "buy", "shares": 1, "price": 100,
              "executed_on": "2026-01-15"},
    )
    assert resp.status_code == 200

    resp = await client.get("/api/feed", params={"holdings_only": "true"})
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) > 0
    assert all(
        any(s["ticker"] == "AAPL" for s in item["stances"]) for item in items
    )


async def test_feed_filters_by_multiple_tickers(api, sessionmaker):
    from datetime import datetime, timezone, timedelta
    from app.models import Channel, Stance, Video, VideoStance, VideoStatus

    _, client = api
    now = datetime.now(timezone.utc)
    async with sessionmaker() as s:
        s.add(Channel(id="cf", title="cf", thumbnail_url="", uploads_playlist_id="UUf"))
        for vid, tk in [("f_aapl", "AAPL"), ("f_nvda", "NVDA"), ("f_tsla", "TSLA")]:
            s.add(Video(id=vid, channel_id="cf", title=tk,
                        published_at=now - timedelta(minutes=1), thumbnail_url="",
                        duration_seconds=60, status=VideoStatus.analyzed))
            s.add(VideoStance(video_id=vid, ticker=tk, stance=Stance.buy, summary="s"))
        await s.commit()

    one = (await client.get("/api/feed", params={"ticker": "AAPL"})).json()["data"]["items"]
    assert {v["video_id"] for v in one} == {"f_aapl"}

    many = (await client.get(
        "/api/feed", params={"ticker": ["AAPL", "NVDA"]}
    )).json()["data"]["items"]
    ids = {v["video_id"] for v in many}
    assert "f_aapl" in ids and "f_nvda" in ids and "f_tsla" not in ids
