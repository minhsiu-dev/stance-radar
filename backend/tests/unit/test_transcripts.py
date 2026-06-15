from dataclasses import dataclass

import pytest

from app.transcripts.client import (
    FakeTranscriptClient,
    Transcript,
    TranscriptNotAvailable,
    TranscriptSegment,
    normalize_segments,
    select_best,
)


@dataclass(frozen=True)
class Candidate:  # mimics the Transcript object interface of youtube-transcript-api
    language_code: str
    is_generated: bool


def test_select_prefers_manual_zh_tw_first():
    candidates = [
        Candidate("en", False),
        Candidate("zh-TW", True),
        Candidate("zh-TW", False),
    ]
    assert select_best(candidates) == Candidate("zh-TW", False)


def test_select_falls_through_priority_then_generated():
    # no manual zh-TW/zh/en subtitles -> take auto-generated within priority
    candidates = [Candidate("ja", False), Candidate("en", True)]
    assert select_best(candidates) == Candidate("en", True)


def test_select_any_manual_beats_any_generated():
    candidates = [Candidate("ja", True), Candidate("ko", False)]
    assert select_best(candidates) == Candidate("ko", False)


def test_select_empty_returns_none():
    assert select_best([]) is None


def test_normalize_strips_and_drops_empty():
    raw = [
        {"start": 1.0, "text": "  蘋果很強  "},
        {"start": 2.0, "text": "   "},
        {"start": 3.5, "text": "NVDA\n也不錯"},
    ]
    segments = normalize_segments(raw)
    assert segments == (
        TranscriptSegment(start_seconds=1.0, text="蘋果很強"),
        TranscriptSegment(start_seconds=3.5, text="NVDA 也不錯"),
    )


async def test_fake_client_returns_transcript_for_seeded_video():
    fake = FakeTranscriptClient()
    transcript = await fake.fetch("alpha_vid_3")
    assert isinstance(transcript, Transcript)
    assert transcript.language == "zh-TW"
    assert any("蘋果" in s.text for s in transcript.segments)


async def test_fake_client_raises_for_no_transcript_video():
    fake = FakeTranscriptClient()
    with pytest.raises(TranscriptNotAvailable):
        await fake.fetch("beta_vid_1")


import pytest
from app.transcripts.client import YouTubeTranscriptApiClient
from app.net.proxy import ProxyRotator


class _CountingRotator(ProxyRotator):
    def __init__(self):
        super().__init__("")
        self.rotations = 0

    async def rotate(self):
        self.rotations += 1


async def test_transcript_rotates_on_ipblocked_then_succeeds(monkeypatch):
    from app.transcripts.client import Transcript
    from youtube_transcript_api import IpBlocked

    rot = _CountingRotator()
    client = YouTubeTranscriptApiClient(proxy_url="http://proxy:8888", rotator=rot)
    calls = {"n": 0}

    def fake_sync(video_id):
        calls["n"] += 1
        if calls["n"] == 1:
            raise IpBlocked("blocked")
        return Transcript("en", ())

    monkeypatch.setattr(client, "_fetch_sync", fake_sync)
    result = await client.fetch("vid")
    assert result.language == "en"
    assert rot.rotations == 1 and calls["n"] == 2


async def test_transcript_no_proxy_does_not_rotate(monkeypatch):
    from youtube_transcript_api import IpBlocked

    rot = _CountingRotator()
    client = YouTubeTranscriptApiClient(proxy_url="", rotator=rot)

    def fake_sync(video_id):
        raise IpBlocked("blocked")

    monkeypatch.setattr(client, "_fetch_sync", fake_sync)
    with pytest.raises(IpBlocked):
        await client.fetch("vid")
    assert rot.rotations == 0
