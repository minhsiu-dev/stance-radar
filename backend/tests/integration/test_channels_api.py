from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.models import Channel, Video, VideoStatus
from tests.conftest import wait_refresh


async def test_add_channels_resolves_and_triggers_refresh(api, session):
    app, client = api
    resp = await client.post(
        "/api/channels", json={"channel_ids": "UC_fake_alpha\nUC_fake_beta"}
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert [c["id"] for c in data["added"]] == ["UC_fake_alpha", "UC_fake_beta"]
    assert data["job_id"] is not None

    await wait_refresh(app)
    statuses = (await session.execute(select(Video.status))).scalars().all()
    assert len(statuses) == 6  # auto-triggered discover pulls in videos
    assert set(statuses) == {VideoStatus.discovered}  # but does not auto-analyze

    listed = await client.get("/api/channels")
    assert [c["id"] for c in listed.json()["data"]] == ["UC_fake_alpha", "UC_fake_beta"]


async def test_add_with_invalid_id_returns_400_but_adds_valid(api, session):
    app, client = api
    resp = await client.post(
        "/api/channels", json={"channel_ids": "UC_fake_alpha, UC_bogus"}
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["success"] is False
    assert body["data"]["failed"] == [{"id": "UC_bogus", "reason": "Channel not found"}]
    assert [c["id"] for c in body["data"]["added"]] == ["UC_fake_alpha"]
    assert await session.get(Channel, "UC_fake_alpha") is not None
    await wait_refresh(app)


async def test_add_channel_by_handle(api, session):
    app, client = api
    resp = await client.post("/api/channels", json={"channel_ids": "@alpha"})
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert [c["id"] for c in data["added"]] == ["UC_fake_alpha"]
    assert await session.get(Channel, "UC_fake_alpha") is not None
    await wait_refresh(app)


async def test_add_channel_by_handle_url(api, session):
    app, client = api
    resp = await client.post(
        "/api/channels", json={"channel_ids": "https://www.youtube.com/@beta"}
    )
    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["data"]["added"]] == ["UC_fake_beta"]
    await wait_refresh(app)


async def test_handle_and_id_for_same_channel_dedupes(api):
    app, client = api
    resp = await client.post(
        "/api/channels", json={"channel_ids": "@alpha\nUC_fake_alpha"}
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert [c["id"] for c in data["added"]] == ["UC_fake_alpha"]
    # The second (same channel) is treated as a duplicate and skipped, reporting the original token
    assert data["skipped"] == ["UC_fake_alpha"]
    await wait_refresh(app)


async def test_unknown_handle_fails(api):
    app, client = api
    resp = await client.post("/api/channels", json={"channel_ids": "@nope"})
    assert resp.status_code == 400
    body = resp.json()
    assert body["data"]["failed"] == [{"id": "@nope", "reason": "Channel not found"}]
    assert body["data"]["added"] == []


async def test_re_adding_existing_channel_is_skipped(api):
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)
    resp = await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    assert resp.status_code == 200
    assert resp.json()["data"]["skipped"] == ["UC_fake_alpha"]
    assert resp.json()["data"]["added"] == []


async def test_delete_channel_and_unknown_404(api, session):
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha"})
    await wait_refresh(app)
    resp = await client.delete("/api/channels/UC_fake_alpha")
    assert resp.status_code == 200
    assert await session.get(Channel, "UC_fake_alpha") is None

    resp = await client.delete("/api/channels/UC_nope")
    assert resp.status_code == 404
    assert resp.json()["success"] is False


async def _seed_alpha_beta_with_analysis(api):
    """alpha: vid_3 (06-08) + vid_2 (05-25) analyzed, vid_1 (05-10) discovered; beta: all discovered."""
    app, client = api
    await client.post("/api/channels", json={"channel_ids": "UC_fake_alpha UC_fake_beta"})
    await wait_refresh(app)
    await client.post("/api/videos/analyze", json={"video_ids": ["alpha_vid_3", "alpha_vid_2"]})
    await wait_refresh(app)
    return app, client


async def test_overview_paginates_in_added_order(api):
    app, client = await _seed_alpha_beta_with_analysis(api)

    r1 = await client.get("/api/channels/overview", params={"page": 1, "page_size": 1})
    assert r1.status_code == 200
    d1 = r1.json()["data"]
    assert d1["total"] == 2
    assert d1["page"] == 1 and d1["page_size"] == 1
    assert [c["id"] for c in d1["items"]] == ["UC_fake_alpha"]
    assert d1["items"][0]["video_counts"]["analyzed"] == 2

    r2 = await client.get("/api/channels/overview", params={"page": 2, "page_size": 1})
    assert [c["id"] for c in r2.json()["data"]["items"]] == ["UC_fake_beta"]

    r3 = await client.get("/api/channels/overview", params={"page": 3, "page_size": 1})
    assert r3.json()["data"]["items"] == []


async def test_overview_weekly_activity_buckets(api, session):
    app, client = await _seed_alpha_beta_with_analysis(api)

    data = (await client.get("/api/channels/overview")).json()["data"]
    alpha = next(c for c in data["items"] if c["id"] == "UC_fake_alpha")
    wa = alpha["weekly_activity"]

    starts = [datetime.fromisoformat(w["week_start"]).date() for w in wa]
    today = datetime.now(timezone.utc).date()
    this_monday = today - timedelta(days=today.weekday())
    assert starts == [this_monday - timedelta(weeks=k) for k in range(4, -1, -1)]

    assert all(w["analyzed"] <= w["total"] for w in wa)

    since = datetime(starts[0].year, starts[0].month, starts[0].day, tzinfo=timezone.utc)
    rows = (await session.execute(
        select(Video.status, func.count())
        .where(Video.channel_id == "UC_fake_alpha", Video.published_at >= since)
        .group_by(Video.status)
    )).all()
    counts = {s.value: n for s, n in rows}
    assert sum(w["total"] for w in wa) == sum(counts.values())
    assert sum(w["analyzed"] for w in wa) == counts.get("analyzed", 0)
