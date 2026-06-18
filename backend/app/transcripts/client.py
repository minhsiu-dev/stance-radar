import asyncio
from dataclasses import dataclass
from typing import Iterable, Protocol, Sequence

from app.net.proxy import ProxyRotator, with_rotation

LANGUAGE_PRIORITY = ("zh-TW", "zh", "en")


class TranscriptNotAvailable(Exception):
    pass


@dataclass(frozen=True)
class TranscriptSegment:
    start_seconds: float
    text: str


@dataclass(frozen=True)
class Transcript:
    language: str
    segments: tuple[TranscriptSegment, ...]


class TranscriptClient(Protocol):
    async def fetch(self, video_id: str) -> Transcript: ...


def select_best(candidates: Sequence) -> object | None:
    """candidates must have .language_code and .is_generated attributes.
    Priority: manual zh-TW -> manual zh -> manual en -> auto-generated (same language order) -> any manual -> any auto.
    """
    manual = [c for c in candidates if not c.is_generated]
    generated = [c for c in candidates if c.is_generated]
    for pool in (manual, generated):
        for lang in LANGUAGE_PRIORITY:
            for candidate in pool:
                if candidate.language_code == lang:
                    return candidate
    if manual:
        return manual[0]
    if generated:
        return generated[0]
    return None


def normalize_segments(raw: Iterable[dict]) -> tuple[TranscriptSegment, ...]:
    segments = []
    for item in raw:
        text = " ".join(str(item["text"]).split())
        if not text:
            continue
        segments.append(TranscriptSegment(start_seconds=float(item["start"]), text=text))
    return tuple(segments)


def transcript_to_json(transcript: Transcript) -> dict:
    """Serialize a Transcript to a JSON-safe dict (segments keep start_seconds + text)."""
    return {
        "language": transcript.language,
        "segments": [
            {"start": s.start_seconds, "text": s.text} for s in transcript.segments
        ],
    }


def transcript_from_json(data: dict) -> Transcript:
    """Inverse of transcript_to_json; reuses normalize_segments for the {start,text} shape."""
    return Transcript(
        language=str(data.get("language") or ""),
        segments=normalize_segments(data.get("segments") or []),
    )


def _is_transcript_blocked(exc: BaseException) -> bool:
    from youtube_transcript_api import IpBlocked, RequestBlocked
    return isinstance(exc, (IpBlocked, RequestBlocked))


class YouTubeTranscriptApiClient:
    def __init__(self, proxy_url: str = "", rotator: ProxyRotator | None = None) -> None:
        self._proxy_url = proxy_url
        self._rotator = rotator or ProxyRotator("")

    async def fetch(self, video_id: str) -> Transcript:
        async def attempt() -> Transcript:
            return await asyncio.to_thread(self._fetch_sync, video_id)

        if not self._proxy_url:
            return await attempt()
        return await with_rotation(attempt, _is_transcript_blocked, self._rotator)

    def _build_api(self):
        from youtube_transcript_api import YouTubeTranscriptApi
        if self._proxy_url:
            from youtube_transcript_api.proxies import GenericProxyConfig
            return YouTubeTranscriptApi(
                proxy_config=GenericProxyConfig(
                    http_url=self._proxy_url, https_url=self._proxy_url
                )
            )
        return YouTubeTranscriptApi()

    def _fetch_sync(self, video_id: str) -> Transcript:
        from youtube_transcript_api import CouldNotRetrieveTranscript

        try:
            transcript_list = self._build_api().list(video_id)
            best = select_best(list(transcript_list))
            if best is None:
                raise TranscriptNotAvailable(video_id)
            fetched = best.fetch()
        except CouldNotRetrieveTranscript as exc:
            # Captions disabled/absent/video unavailable -> permanent, mark no_transcript
            raise TranscriptNotAvailable(video_id) from exc
        raw = [{"start": s.start, "text": s.text} for s in fetched]
        return Transcript(
            language=best.language_code, segments=normalize_segments(raw)
        )


_FAKE_TRANSCRIPTS: dict[str, Transcript] = {
    "alpha_vid_3": Transcript("zh-TW", normalize_segments([
        {"start": 5.0, "text": "今天來看蘋果的財報"},
        {"start": 12.5, "text": "蘋果這季財報很強,我會買"},
        {"start": 60.0, "text": "以上是今天的內容"},
    ])),
    "alpha_vid_2": Transcript("zh-TW", normalize_segments([
        {"start": 10.0, "text": "輝達漲很多了"},
        {"start": 33.0, "text": "估值太貴,我會先獲利了結輝達"},
    ])),
    "alpha_vid_1": Transcript("zh-TW", normalize_segments([
        {"start": 3.0, "text": "今天聊聊大盤,沒有個股"},
    ])),
    "beta_vid_3": Transcript("en", normalize_segments([
        {"start": 45.0, "text": "Tesla delivery numbers look just okay this quarter"},
    ])),
    "beta_vid_2": Transcript("zh-TW", normalize_segments([
        {"start": 10.0, "text": "蘋果我持續加碼"},
        {"start": 200.0, "text": "輝達就觀望,等回檔"},
    ])),
    # beta_vid_1 is intentionally absent -> TranscriptNotAvailable (exercises the no_transcript path)
}


class FakeTranscriptClient:
    """Deterministic fake data; beta_vid_1 always raises TranscriptNotAvailable."""

    async def fetch(self, video_id: str) -> Transcript:
        if video_id not in _FAKE_TRANSCRIPTS:
            raise TranscriptNotAvailable(video_id)
        return _FAKE_TRANSCRIPTS[video_id]
