from types import SimpleNamespace

import pytest

from app.analysis.llm import (
    AnalysisError,
    ClaudeLLMClient,
    FakeLLMClient,
    parse_analysis_response,
)
from app.analysis.types import AnalysisResult, MentionResult, StanceResult
from app.transcripts.client import Transcript, TranscriptSegment


def tool_response(input_payload: dict) -> SimpleNamespace:
    return SimpleNamespace(content=[
        SimpleNamespace(type="text", text="thinking..."),
        SimpleNamespace(type="tool_use", name="record_analysis", input=input_payload),
    ])


def test_parse_happy_path():
    resp = tool_response({
        "mentions": [{
            "ticker": "aapl", "start_seconds": 12.5, "quote": "蘋果很強,我會買",
            "stance": "buy", "reasoning": "明確看多",
        }],
        "stances": [{"ticker": "AAPL", "stance": "buy", "summary": "整體看多"}],
    })
    result = parse_analysis_response(resp)
    assert result.mentions[0].ticker == "AAPL"  # 自動轉大寫
    assert result.stances[0].stance == "buy"


def test_parse_invalid_stance_raises():
    resp = tool_response({
        "mentions": [{
            "ticker": "AAPL", "start_seconds": 1.0, "quote": "q",
            "stance": "hold", "reasoning": "r",
        }],
        "stances": [],
    })
    with pytest.raises(AnalysisError):
        parse_analysis_response(resp)


def test_parse_missing_tool_block_raises():
    resp = SimpleNamespace(content=[SimpleNamespace(type="text", text="no tool")])
    with pytest.raises(AnalysisError):
        parse_analysis_response(resp)


def test_parse_fills_missing_overall_stance_by_majority():
    resp = tool_response({
        "mentions": [
            {"ticker": "NVDA", "start_seconds": 1.0, "quote": "a",
             "stance": "sell", "reasoning": "r1"},
            {"ticker": "NVDA", "start_seconds": 2.0, "quote": "b",
             "stance": "sell", "reasoning": "r2"},
            {"ticker": "NVDA", "start_seconds": 3.0, "quote": "c",
             "stance": "buy", "reasoning": "r3"},
        ],
        "stances": [],  # 模型漏給整體立場
    })
    result = parse_analysis_response(resp)
    assert len(result.stances) == 1
    assert result.stances[0].ticker == "NVDA"
    assert result.stances[0].stance == "sell"  # 多數決


async def test_claude_client_retries_then_succeeds():
    transcript = Transcript("zh-TW", (TranscriptSegment(1.0, "蘋果很強"),))
    attempts = {"n": 0}

    async def fake_create(**kwargs):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise ConnectionError("boom")
        return tool_response({"mentions": [], "stances": []})

    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    client = ClaudeLLMClient(api_key="k", model="m", sleep=fake_sleep)
    client._client = SimpleNamespace(
        messages=SimpleNamespace(create=fake_create)
    )
    result = await client.analyze(
        video_id="v1", video_title="t", transcript=transcript
    )
    assert result == AnalysisResult.empty()
    assert attempts["n"] == 3
    assert sleeps == [1, 2]  # 指數退避


async def test_claude_client_raises_after_max_retries():
    transcript = Transcript("zh-TW", (TranscriptSegment(1.0, "x"),))

    async def always_fail(**kwargs):
        raise ConnectionError("boom")

    async def no_sleep(seconds: float) -> None:
        pass

    client = ClaudeLLMClient(api_key="k", model="m", sleep=no_sleep)
    client._client = SimpleNamespace(messages=SimpleNamespace(create=always_fail))
    with pytest.raises(AnalysisError):
        await client.analyze(video_id="v1", video_title="t", transcript=transcript)


async def test_fake_llm_returns_seeded_results():
    fake = FakeLLMClient()
    transcript = Transcript("zh-TW", (TranscriptSegment(1.0, "x"),))
    result = await fake.analyze(
        video_id="alpha_vid_3", video_title="t", transcript=transcript
    )
    assert result.mentions[0] == MentionResult(
        ticker="AAPL", start_seconds=12.5, quote="蘋果這季財報很強,我會買",
        stance="buy", reasoning="財報優於預期,明確看多",
    )
    assert result.stances[0].stance == "buy"
    empty = await fake.analyze(
        video_id="alpha_vid_1", video_title="t", transcript=transcript
    )
    assert empty == AnalysisResult.empty()
