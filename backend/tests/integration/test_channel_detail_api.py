from datetime import datetime, timezone

from tests.conftest import wait_refresh
from app.models import Stance, Video, VideoStance


async def seed_two_phase(api) -> tuple:
    app, client = api
    await client.post(
        "/api/channels", json={"channel_ids": "UC_fake_alpha UC_fake_beta"}
    )
    await wait_refresh(app)
    # Analyze only two of alpha's videos, skip one; beta stays discovered
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
    # alpha_vid_3 → AAPL buy (fixed data from fake adapter)
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
    # seed_two_phase analyzed alpha_vid_3 (AAPL buy, 2026-06-08)
    # and alpha_vid_2 (NVDA sell, 2026-05-25); alpha_vid_1 was skipped
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


async def test_latest_stance_newest_wins(api):
    # seed_two_phase already analyzed alpha_vid_3 (AAPL buy, 2026-06-08)
    # Directly insert an older AAPL neutral stance on alpha_vid_2 (2026-05-25)
    # Assert latest_stance is still "buy" (the newer alpha_vid_3 wins)
    app, client = await seed_two_phase(api)

    async with app.state.sessionmaker() as s:
        s.add(VideoStance(
            video_id="alpha_vid_2",
            ticker="AAPL",
            stance=Stance.neutral,
            summary="older view",
        ))
        await s.commit()

    resp = await client.get("/api/channels/UC_fake_alpha")
    assert resp.status_code == 200
    tickers = {t["ticker"]: t for t in resp.json()["data"]["top_tickers"]}
    assert tickers["AAPL"]["latest_stance"] == "buy"
    assert tickers["AAPL"]["latest_date"] == "2026-06-08"
