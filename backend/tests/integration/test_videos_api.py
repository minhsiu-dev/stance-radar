from app.models import Video, VideoStatus
from tests.conftest import wait_refresh


async def add_channels_and_discover(app, client) -> None:
    resp = await client.post(
        "/api/channels", json={"channel_ids": "UC_fake_alpha UC_fake_beta"}
    )
    assert resp.status_code == 200
    await wait_refresh(app)


async def analyze(client, app, video_ids: list[str]):
    resp = await client.post("/api/videos/analyze", json={"video_ids": video_ids})
    assert resp.status_code == 200, resp.text
    await wait_refresh(app)
    return resp


async def test_discovered_videos_grouped_by_channel(api):
    app, client = api
    await add_channels_and_discover(app, client)

    resp = await client.get("/api/videos", params={"status": "discovered"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 6
    by_channel = {g["channel"]["id"]: g for g in data["groups"]}
    assert set(by_channel) == {"UC_fake_alpha", "UC_fake_beta"}
    alpha = by_channel["UC_fake_alpha"]
    assert alpha["channel"]["title"] == "頻道 Alpha"
    assert [v["id"] for v in alpha["videos"]] == [
        "alpha_vid_3", "alpha_vid_2", "alpha_vid_1",
    ]  # 新→舊
    first = alpha["videos"][0]
    assert first["status"] == "discovered"
    assert first["duration_seconds"] == 600


async def test_unknown_status_rejected(api):
    app, client = api
    resp = await client.get("/api/videos", params={"status": "bogus"})
    assert resp.status_code == 400
    assert resp.json()["success"] is False


async def test_feed_hides_discovered_and_skipped(api):
    app, client = api
    await add_channels_and_discover(app, client)
    feed = (await client.get("/api/feed")).json()["data"]
    assert feed["total"] == 0  # 未挑選不進 feed

    resp = await client.post(
        "/api/videos/skip", json={"video_ids": ["alpha_vid_1"]}
    )
    assert resp.status_code == 200
    feed = (await client.get("/api/feed")).json()["data"]
    assert feed["total"] == 0


async def test_analyze_selected_videos_only(api):
    app, client = api
    await add_channels_and_discover(app, client)

    resp = await analyze(client, app, ["alpha_vid_3"])
    data = resp.json()["data"]
    assert data["created"] is True
    assert data["queued"] == 1

    feed = (await client.get("/api/feed")).json()["data"]
    assert feed["total"] == 1
    assert feed["items"][0]["video_id"] == "alpha_vid_3"
    assert feed["items"][0]["status"] == "analyzed"


async def test_skip_then_rediscover_does_not_resurrect(api):
    app, client = api
    await add_channels_and_discover(app, client)
    # alpha_vid_3 是最新影片(分頁停止點),略過它最容易觸發復活 bug
    resp = await client.post(
        "/api/videos/skip", json={"video_ids": ["alpha_vid_3"]}
    )
    assert resp.status_code == 200

    await client.post("/api/refresh")
    await wait_refresh(app)
    resp = await client.get("/api/videos", params={"status": "discovered"})
    assert resp.json()["data"]["total"] == 5  # 不會多出重複的 alpha_vid_3


async def test_skipped_video_recoverable_via_analyze(api):
    app, client = api
    await add_channels_and_discover(app, client)
    await client.post("/api/videos/skip", json={"video_ids": ["alpha_vid_3"]})

    await analyze(client, app, ["alpha_vid_3"])
    feed = (await client.get("/api/feed")).json()["data"]
    assert feed["items"][0]["video_id"] == "alpha_vid_3"
    assert feed["items"][0]["status"] == "analyzed"


async def test_skip_analyzed_video_rejected(api):
    app, client = api
    await add_channels_and_discover(app, client)
    await analyze(client, app, ["alpha_vid_3"])

    resp = await client.post(
        "/api/videos/skip", json={"video_ids": ["alpha_vid_3"]}
    )
    assert resp.status_code == 400
    assert "alpha_vid_3" in resp.json()["error"]


async def test_analyze_unknown_video_404(api):
    app, client = api
    await add_channels_and_discover(app, client)
    resp = await client.post(
        "/api/videos/analyze", json={"video_ids": ["alpha_vid_3", "nope"]}
    )
    assert resp.status_code == 404
    assert "nope" in resp.json()["error"]
    # 整批拒絕:有效影片不可被改動
    app_session = app.state.sessionmaker
    async with app_session() as s:
        video = await s.get(Video, "alpha_vid_3")
        assert video.status == VideoStatus.discovered


async def test_analyze_empty_list_400(api):
    app, client = api
    resp = await client.post("/api/videos/analyze", json={"video_ids": []})
    assert resp.status_code == 400


async def test_video_detail_groups_mentions_by_ticker(api):
    app, client = api
    await add_channels_and_discover(app, client)
    # 拿一部會被分析成 analyzed 的影片
    await analyze(client, app, ["alpha_vid_3"])
    feed = (await client.get("/api/feed")).json()["data"]
    vid = feed["items"][0]["video_id"]

    resp = await client.get(f"/api/videos/{vid}")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]

    assert data["video"]["id"] == vid
    assert data["video"]["channel"]["id"]  # 有帶頻道
    assert data["video"]["status"] == "analyzed"

    groups = data["groups"]
    assert len(groups) >= 1
    g = groups[0]
    assert set(g) >= {"ticker", "stance", "summary", "confidence", "mentions"}
    assert len(g["mentions"]) >= 1
    m = g["mentions"][0]
    assert set(m) >= {
        "start_seconds", "quote", "stance", "confidence",
        "time_horizon", "is_conditional", "condition",
    }
    # 組內依秒數遞增
    secs = [x["start_seconds"] for x in g["mentions"]]
    assert secs == sorted(secs)


async def test_video_detail_unknown_id_404(api):
    app, client = api
    resp = await client.get("/api/videos/does_not_exist")
    assert resp.status_code == 404
    assert resp.json()["success"] is False
