import json

import pytest

from app.analysis.llm import (
    AnalysisError,
    ClaudeCLIClient,
    FakeLLMClient,
    parse_analysis_payload,
    parse_cli_stdout,
)
from app.analysis.types import AnalysisResult, MentionResult, StanceResult
from app.transcripts.client import Transcript, TranscriptSegment


def _wrap(result_text: str) -> bytes:
    return json.dumps({"type": "result", "result": result_text}).encode("utf-8")


def _wrap_payload(payload: dict) -> bytes:
    return _wrap(json.dumps(payload, ensure_ascii=False))


# ---- parse_analysis_payload (pure dict parsing) ----


def test_parse_payload_happy_path():
    result = parse_analysis_payload({
        "mentions": [{
            "ticker": "aapl", "start_seconds": 12.5, "quote": "蘋果很強,我會買",
            "stance": "buy", "reasoning": "明確看多",
        }],
        "stances": [{"ticker": "AAPL", "stance": "buy", "summary": "整體看多"}],
    })
    assert result.mentions[0].ticker == "AAPL"  # auto-uppercased
    assert result.stances[0].stance == "buy"


def test_parse_payload_invalid_stance_raises():
    with pytest.raises(AnalysisError):
        parse_analysis_payload({
            "mentions": [{
                "ticker": "AAPL", "start_seconds": 1.0, "quote": "q",
                "stance": "hold", "reasoning": "r",
            }],
            "stances": [],
        })


def test_parse_payload_fills_missing_overall_stance_by_majority():
    result = parse_analysis_payload({
        "mentions": [
            {"ticker": "NVDA", "start_seconds": 1.0, "quote": "a",
             "stance": "sell", "reasoning": "r1"},
            {"ticker": "NVDA", "start_seconds": 2.0, "quote": "b",
             "stance": "sell", "reasoning": "r2"},
            {"ticker": "NVDA", "start_seconds": 3.0, "quote": "c",
             "stance": "buy", "reasoning": "r3"},
        ],
        "stances": [],  # model omitted the overall stance entry
    })
    assert len(result.stances) == 1
    assert result.stances[0].ticker == "NVDA"
    assert result.stances[0].stance == "sell"  # majority vote


# ---- parse_cli_stdout (CLI wrapper unwrap + fence stripping) ----


def test_parse_cli_stdout_unwraps_result_field():
    stdout = _wrap_payload({"mentions": [], "stances": []})
    assert parse_cli_stdout(stdout) == AnalysisResult.empty()


def test_parse_cli_stdout_strips_markdown_code_fence():
    fenced = "```json\n" + json.dumps({"mentions": [], "stances": []}) + "\n```"
    stdout = _wrap(fenced)
    assert parse_cli_stdout(stdout) == AnalysisResult.empty()


def test_parse_cli_stdout_non_json_raises():
    with pytest.raises(AnalysisError):
        parse_cli_stdout(b"this is not json")


def test_parse_cli_stdout_inner_text_not_json_raises():
    stdout = _wrap("hello, I'm not JSON")
    with pytest.raises(AnalysisError):
        parse_cli_stdout(stdout)


# ---- ClaudeCLIClient (subprocess flow + retry) ----


async def test_cli_client_retries_then_succeeds():
    transcript = Transcript("zh-TW", (TranscriptSegment(1.0, "蘋果很強"),))
    calls: list[list[str]] = []
    sleeps: list[float] = []

    async def fake_run(args, stdin_data):
        calls.append(args)
        if len(calls) < 3:
            return (1, b"", b"network blip")
        return (0, _wrap_payload({"mentions": [], "stances": []}), b"")

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    client = ClaudeCLIClient(
        model="claude-haiku-4-5",
        sleep=fake_sleep,
        runner=fake_run,
    )
    result = await client.analyze(
        video_id="v1", video_title="t", transcript=transcript
    )
    assert result == AnalysisResult.empty()
    assert len(calls) == 3
    assert sleeps == [1, 2]  # exponential backoff
    # args include the required CLI flags
    args = calls[0]
    assert args[0] == "claude"
    assert "-p" in args
    assert "--output-format" in args and "json" in args
    assert "--model" in args and "claude-haiku-4-5" in args


async def test_cli_client_raises_after_max_retries():
    transcript = Transcript("zh-TW", (TranscriptSegment(1.0, "x"),))

    async def always_fail(args, stdin_data):
        return (2, b"", b"auth required")

    async def no_sleep(_: float) -> None:
        pass

    client = ClaudeCLIClient(
        model="m", sleep=no_sleep, runner=always_fail,
    )
    with pytest.raises(AnalysisError):
        await client.analyze(video_id="v1", video_title="t", transcript=transcript)


async def test_cli_client_sends_full_prompt_to_stdin():
    transcript = Transcript(
        "zh-TW",
        (TranscriptSegment(12.5, "蘋果很強"), TranscriptSegment(60.0, "輝達觀望")),
    )
    seen: dict[str, bytes] = {}

    async def capture(args, stdin_data):
        seen["stdin"] = stdin_data
        return (0, _wrap_payload({"mentions": [], "stances": []}), b"")

    async def no_sleep(_: float) -> None:
        pass

    client = ClaudeCLIClient(model="m", sleep=no_sleep, runner=capture)
    await client.analyze(
        video_id="v1", video_title="AAPL 財報解讀", transcript=transcript
    )
    decoded = seen["stdin"].decode("utf-8")
    assert "AAPL 財報解讀" in decoded                    # title in user prompt
    assert "[12.5] 蘋果很強" in decoded                   # transcript line
    assert "record_analysis" in decoded                   # system prompt fragment
    assert "JSON" in decoded.upper()                      # JSON-only instruction


# ---- FakeLLMClient (seeded results) ----


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
