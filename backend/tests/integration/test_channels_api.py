from sqlalchemy import select

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
