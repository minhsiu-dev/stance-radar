import asyncio
from dataclasses import dataclass
from typing import Iterable, Protocol, Sequence

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
    """candidates 需有 .language_code 與 .is_generated 屬性。
    優先序:手動 zh-TW → 手動 zh → 手動 en → 自動(同語言順序)→ 任何手動 → 任何自動。
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


class YouTubeTranscriptApiClient:
    async def fetch(self, video_id: str) -> Transcript:
        return await asyncio.to_thread(self._fetch_sync, video_id)

    def _fetch_sync(self, video_id: str) -> Transcript:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api import CouldNotRetrieveTranscript

        try:
            transcript_list = YouTubeTranscriptApi().list(video_id)
            best = select_best(list(transcript_list))
            if best is None:
                raise TranscriptNotAvailable(video_id)
            fetched = best.fetch()
        except CouldNotRetrieveTranscript as exc:
            # 字幕關閉/不存在/影片不可用 → 永久性,標 no_transcript
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
    # beta_vid_1 刻意缺席 → TranscriptNotAvailable(測 no_transcript 路徑)
}


class FakeTranscriptClient:
    """確定性假資料;beta_vid_1 永遠丟 TranscriptNotAvailable。"""

    async def fetch(self, video_id: str) -> Transcript:
        if video_id not in _FAKE_TRANSCRIPTS:
            raise TranscriptNotAvailable(video_id)
        return _FAKE_TRANSCRIPTS[video_id]
