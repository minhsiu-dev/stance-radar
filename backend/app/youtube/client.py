import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

import httpx

BASE_URL = "https://www.googleapis.com/youtube/v3"
_MAX_PAGES = 20  # 保險:避免 known ids 永遠對不上時無限翻頁


class YouTubeError(Exception):
    pass


class ChannelNotFound(YouTubeError):
    pass


class QuotaExceededError(YouTubeError):
    pass


@dataclass(frozen=True)
class ChannelInfo:
    id: str
    title: str
    thumbnail_url: str
    uploads_playlist_id: str


@dataclass(frozen=True)
class VideoInfo:
    id: str
    title: str
    published_at: datetime
    thumbnail_url: str


class YouTubeClient(Protocol):
    async def resolve_channel(self, channel_id: str) -> ChannelInfo: ...
    async def list_new_uploads(
        self, playlist_id: str, *, known_video_ids: set[str], limit: int | None
    ) -> list[VideoInfo]: ...
    async def get_durations(self, video_ids: list[str]) -> dict[str, int]: ...


_DURATION_RE = re.compile(
    r"^P(?:(?P<d>\d+)D)?T?(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+)S)?$"
)


def parse_iso8601_duration(raw: str) -> int:
    match = _DURATION_RE.match(raw)
    if match is None:
        raise ValueError(f"unparseable ISO8601 duration: {raw}")
    parts = {k: int(v) for k, v in match.groupdict().items() if v}
    return (
        parts.get("d", 0) * 86400
        + parts.get("h", 0) * 3600
        + parts.get("m", 0) * 60
        + parts.get("s", 0)
    )


def _parse_published(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc)


def _medium_thumbnail(snippet: dict) -> str:
    thumbs = snippet.get("thumbnails", {})
    for key in ("medium", "default", "high"):
        if key in thumbs:
            return thumbs[key].get("url", "")
    return ""


class DataAPIYouTubeClient:
    def __init__(self, api_key: str, transport: httpx.AsyncBaseTransport | None = None):
        self._api_key = api_key
        self._http = httpx.AsyncClient(base_url=BASE_URL, transport=transport, timeout=30)

    async def _get(self, path: str, params: dict) -> dict:
        resp = await self._http.get(path, params={**params, "key": self._api_key})
        if resp.status_code == 403:
            reasons = [
                e.get("reason")
                for e in resp.json().get("error", {}).get("errors", [])
            ]
            if "quotaExceeded" in reasons:
                raise QuotaExceededError("YouTube API quota 已用盡,明日重試")
        if resp.status_code != 200:
            raise YouTubeError(f"YouTube API {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    async def resolve_channel(self, channel_id: str) -> ChannelInfo:
        data = await self._get(
            "/channels", {"part": "snippet,contentDetails", "id": channel_id}
        )
        items = data.get("items", [])
        if not items:
            raise ChannelNotFound(channel_id)
        item = items[0]
        snippet = item["snippet"]
        return ChannelInfo(
            id=item["id"],
            title=snippet["title"],
            thumbnail_url=_medium_thumbnail(snippet),
            uploads_playlist_id=item["contentDetails"]["relatedPlaylists"]["uploads"],
        )

    async def list_new_uploads(
        self, playlist_id: str, *, known_video_ids: set[str], limit: int | None
    ) -> list[VideoInfo]:
        collected: list[VideoInfo] = []
        page_token: str | None = None
        for _ in range(_MAX_PAGES):
            params = {
                "part": "snippet,contentDetails",
                "playlistId": playlist_id,
                "maxResults": 50,
            }
            if page_token:
                params["pageToken"] = page_token
            data = await self._get("/playlistItems", params)
            for item in data.get("items", []):
                details = item["contentDetails"]
                video_id = details["videoId"]
                if video_id in known_video_ids:
                    return collected
                snippet = item["snippet"]
                published_raw = details.get("videoPublishedAt") or snippet["publishedAt"]
                collected.append(VideoInfo(
                    id=video_id,
                    title=snippet["title"],
                    published_at=_parse_published(published_raw),
                    thumbnail_url=_medium_thumbnail(snippet),
                ))
                if limit is not None and len(collected) >= limit:
                    return collected
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return collected

    async def get_durations(self, video_ids: list[str]) -> dict[str, int]:
        durations: dict[str, int] = {}
        for i in range(0, len(video_ids), 50):
            batch = video_ids[i : i + 50]
            data = await self._get(
                "/videos", {"part": "contentDetails", "id": ",".join(batch)}
            )
            for item in data.get("items", []):
                durations[item["id"]] = parse_iso8601_duration(
                    item["contentDetails"]["duration"]
                )
        return durations

    async def aclose(self) -> None:
        await self._http.aclose()


def _fake_video(video_id: str, title: str, published: str) -> VideoInfo:
    return VideoInfo(
        id=video_id,
        title=title,
        published_at=datetime.fromisoformat(published).replace(tzinfo=timezone.utc),
        thumbnail_url=f"https://fake.example/{video_id}.jpg",
    )


class FakeYouTubeClient:
    """確定性假資料,整合測試與 USE_FAKE_ADAPTERS=true 模式使用。"""

    CHANNELS = {
        "UC_fake_alpha": ChannelInfo(
            id="UC_fake_alpha", title="頻道 Alpha",
            thumbnail_url="https://fake.example/alpha.jpg",
            uploads_playlist_id="UU_fake_alpha",
        ),
        "UC_fake_beta": ChannelInfo(
            id="UC_fake_beta", title="頻道 Beta",
            thumbnail_url="https://fake.example/beta.jpg",
            uploads_playlist_id="UU_fake_beta",
        ),
    }
    UPLOADS = {
        "UU_fake_alpha": [  # 新→舊排序,與真實 API 一致
            _fake_video("alpha_vid_3", "AAPL 財報解讀", "2026-06-08T12:00:00"),
            _fake_video("alpha_vid_2", "NVDA 還能追嗎", "2026-05-25T12:00:00"),
            _fake_video("alpha_vid_1", "大盤閒聊", "2026-05-10T12:00:00"),
        ],
        "UU_fake_beta": [
            _fake_video("beta_vid_3", "TSLA 交車數據", "2026-06-05T12:00:00"),
            _fake_video("beta_vid_2", "AAPL vs NVDA", "2026-05-20T12:00:00"),
            _fake_video("beta_vid_1", "投資心法", "2026-05-01T12:00:00"),
        ],
    }

    async def resolve_channel(self, channel_id: str) -> ChannelInfo:
        if channel_id not in self.CHANNELS:
            raise ChannelNotFound(channel_id)
        return self.CHANNELS[channel_id]

    async def list_new_uploads(
        self, playlist_id: str, *, known_video_ids: set[str], limit: int | None
    ) -> list[VideoInfo]:
        collected: list[VideoInfo] = []
        for video in self.UPLOADS.get(playlist_id, []):
            if video.id in known_video_ids:
                break
            collected.append(video)
            if limit is not None and len(collected) >= limit:
                break
        return collected

    async def get_durations(self, video_ids: list[str]) -> dict[str, int]:
        return {vid: 600 for vid in video_ids}
