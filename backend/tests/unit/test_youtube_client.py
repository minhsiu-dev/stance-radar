import json
from datetime import datetime, timezone

import httpx
import pytest

from app.youtube.client import (
    ChannelInfo,
    ChannelNotFound,
    DataAPIYouTubeClient,
    FakeYouTubeClient,
    QuotaExceededError,
    VideoInfo,
    parse_iso8601_duration,
)


def make_client(handler) -> DataAPIYouTubeClient:
    transport = httpx.MockTransport(handler)
    return DataAPIYouTubeClient(api_key="test-key", transport=transport)


# ---- parse_iso8601_duration ----

@pytest.mark.parametrize("raw,expected", [
    ("PT1H2M3S", 3723),
    ("PT15M", 900),
    ("PT45S", 45),
    ("P1DT1S", 86401),
])
def test_parse_iso8601_duration(raw, expected):
    assert parse_iso8601_duration(raw) == expected


# ---- resolve_channel ----

async def test_resolve_channel_parses_fields():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/channels")
        assert request.url.params["id"] == "UCabc"
        assert request.url.params["key"] == "test-key"
        return httpx.Response(200, json={"items": [{
            "id": "UCabc",
            "snippet": {
                "title": "頻道 Alpha",
                "thumbnails": {"medium": {"url": "https://img/alpha.jpg"}},
            },
            "contentDetails": {"relatedPlaylists": {"uploads": "UUabc"}},
        }]})

    info = await make_client(handler).resolve_channel("UCabc")
    assert info == ChannelInfo(
        id="UCabc", title="頻道 Alpha",
        thumbnail_url="https://img/alpha.jpg", uploads_playlist_id="UUabc",
    )


async def test_resolve_unknown_channel_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"items": []})

    with pytest.raises(ChannelNotFound):
        await make_client(handler).resolve_channel("UCnope")


async def test_quota_exceeded_maps_to_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={
            "error": {"errors": [{"reason": "quotaExceeded"}], "message": "quota"}
        })

    with pytest.raises(QuotaExceededError):
        await make_client(handler).resolve_channel("UCabc")


# ---- list_new_uploads ----

def _page(items, next_token=None):
    body = {"items": items}
    if next_token:
        body["nextPageToken"] = next_token
    return body


def _item(video_id: str, title: str = "t", published: str = "2026-06-01T00:00:00Z"):
    return {
        "snippet": {
            "title": title,
            "thumbnails": {"medium": {"url": f"https://img/{video_id}.jpg"}},
        },
        "contentDetails": {"videoId": video_id, "videoPublishedAt": published},
    }


async def test_list_paginates_until_no_next_token():
    pages = {
        None: _page([_item("v1"), _item("v2")], next_token="tok2"),
        "tok2": _page([_item("v3")]),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        token = request.url.params.get("pageToken")
        return httpx.Response(200, json=pages[token])

    videos = await make_client(handler).list_new_uploads(
        "UUabc", known_video_ids=set(), limit=None
    )
    assert [v.id for v in videos] == ["v1", "v2", "v3"]
    assert videos[0].published_at == datetime(2026, 6, 1, tzinfo=timezone.utc)


async def test_list_stops_at_known_video():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json=_page([_item("new1"), _item("seen1"), _item("old1")])
        )

    videos = await make_client(handler).list_new_uploads(
        "UUabc", known_video_ids={"seen1"}, limit=None
    )
    assert [v.id for v in videos] == ["new1"]


async def test_list_respects_limit():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_page([_item(f"v{i}") for i in range(50)], next_token="more"),
        )

    videos = await make_client(handler).list_new_uploads(
        "UUabc", known_video_ids=set(), limit=30
    )
    assert len(videos) == 30


# ---- get_durations ----

async def test_get_durations_batches_and_parses():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/videos")
        assert request.url.params["id"] == "v1,v2"
        return httpx.Response(200, json={"items": [
            {"id": "v1", "contentDetails": {"duration": "PT10M"}},
            {"id": "v2", "contentDetails": {"duration": "PT1H"}},
        ]})

    durations = await make_client(handler).get_durations(["v1", "v2"])
    assert durations == {"v1": 600, "v2": 3600}


# ---- Fake ----

async def test_fake_client_has_seeded_channels():
    fake = FakeYouTubeClient()
    info = await fake.resolve_channel("UC_fake_alpha")
    assert info.uploads_playlist_id == "UU_fake_alpha"
    videos = await fake.list_new_uploads("UU_fake_alpha", known_video_ids=set(), limit=30)
    assert len(videos) == 3
    with pytest.raises(ChannelNotFound):
        await fake.resolve_channel("UC_unknown")


# ---- list_older_uploads ----

async def test_fake_list_older_skips_known_and_collects_older():
    yt = FakeYouTubeClient()
    # latest one known -> should get the remaining two older ones (skip known, don't stop at first known)
    older = await yt.list_older_uploads(
        "UU_fake_alpha", known_video_ids={"alpha_vid_3"}, limit=10
    )
    assert [v.id for v in older] == ["alpha_vid_2", "alpha_vid_1"]
    # limit takes effect
    one = await yt.list_older_uploads(
        "UU_fake_alpha", known_video_ids={"alpha_vid_3"}, limit=1
    )
    assert [v.id for v in one] == ["alpha_vid_2"]
    # all known -> empty
    assert await yt.list_older_uploads(
        "UU_fake_alpha",
        known_video_ids={"alpha_vid_1", "alpha_vid_2", "alpha_vid_3"},
        limit=10,
    ) == []


async def test_data_api_list_older_walks_past_known_block():
    # real client: skip known (continue), walk to older videos rather than stopping at first known
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_page([_item("seen1"), _item("seen2"), _item("old1"), _item("old2")]),
        )

    videos = await make_client(handler).list_older_uploads(
        "UUabc", known_video_ids={"seen1", "seen2"}, limit=10
    )
    assert [v.id for v in videos] == ["old1", "old2"]


async def test_data_api_list_older_respects_limit():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_page([_item(f"v{i}") for i in range(50)], next_token="more"),
        )

    videos = await make_client(handler).list_older_uploads(
        "UUabc", known_video_ids=set(), limit=5
    )
    assert len(videos) == 5
