import json

import pytest

from app.analysis.llm import (
    AnalysisError,
    ClaudeCLIClient,
    FakeLLMClient,
    _default_runner,
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


# ---- _default_runner (timeout behavior) ----


async def test_default_runner_times_out_and_kills_process():
    # a real child that would run far longer than the timeout
    with pytest.raises(AnalysisError):
        await _default_runner(["sleep", "5"], b"", timeout=0.2)


async def test_default_runner_no_timeout_runs_to_completion():
    # cat echoes stdin back; timeout=None must behave like before (no timeout)
    code, out, err = await _default_runner(["cat"], b"hello", timeout=None)
    assert code == 0
    assert out == b"hello"


# ---- _default_runner under uvloop ----
#
# The suite runs on the stdlib loop, but uvicorn serves on uvloop. The two differ
# exactly where it hurts: writing to the stdin of an already-exited child is a
# swallowed BrokenPipeError on stdlib and a raised RuntimeError on uvloop. These
# cases therefore have to drive a real uvloop loop to mean anything.


def _on_uvloop(make_coro):
    import uvloop

    return uvloop.run(make_coro())


# stdin big enough that the child cannot drain it into the pipe buffer and exit
_UNDRAINABLE_STDIN = b"x" * (1024 * 1024)


def test_default_runner_does_not_crash_when_child_exits_before_reading_stdin():
    # `true` exits before the stdin write is even attempted, so uvloop finds the
    # transport already closed. A child that dies early is the LLM CLI failing —
    # the runner has to report that, not die with the transport's own RuntimeError.
    # (Anything slower, e.g. `sh -c ...`, wins the race and hides this.)
    code, out, err = _on_uvloop(
        lambda: _default_runner(["true"], _UNDRAINABLE_STDIN, timeout=10)
    )
    assert code == 0


def test_default_runner_timeout_still_reported_as_timeout_on_uvloop():
    # The child never reads stdin, so the write is still pending when the timeout
    # cancels it; tearing that down must not replace the timeout with its own error.
    with pytest.raises(AnalysisError, match="timed out"):
        _on_uvloop(
            lambda: _default_runner(
                ["sh", "-c", "sleep 5"], _UNDRAINABLE_STDIN, timeout=0.3
            )
        )


def test_default_runner_keeps_child_stderr_when_stdin_is_never_drained():
    # The child fails without reading its 1MB of stdin. Whether the write breaks or
    # merely blocks, its exit code and stderr are the actual diagnosis and must
    # survive — feeding stdin must never be able to discard the reads.
    for _ in range(6):
        code, out, err = _on_uvloop(
            lambda: _default_runner(
                ["sh", "-c", "echo boom >&2; exit 3"], _UNDRAINABLE_STDIN, timeout=10
            )
        )
        assert code == 3
        assert b"boom" in err


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
        confidence="high", time_horizon="long", is_conditional=False,
    )
    assert result.stances[0].stance == "buy"
    empty = await fake.analyze(
        video_id="alpha_vid_1", video_title="t", transcript=transcript
    )
    assert empty == AnalysisResult.empty()


# ---- overall stance is_conditional (parse + derive) ----


def test_parse_payload_reads_overall_is_conditional():
    result = parse_analysis_payload({
        "mentions": [],
        "stances": [{
            "ticker": "AMD", "stance": "sell", "summary": "exit plan at 625+",
            "confidence": "high", "is_conditional": True,
        }],
    })
    assert result.stances[0].is_conditional is True


def test_fill_missing_stance_marks_conditional_when_backing_mentions_conditional():
    result = parse_analysis_payload({
        "mentions": [{
            "ticker": "AMD", "start_seconds": 1.0, "quote": "exit plan",
            "stance": "sell", "reasoning": "will trim at 625+",
            "is_conditional": True, "condition": "at 625+",
        }],
        "stances": [],  # model omitted the overall stance entry
    })
    assert result.stances[0].stance == "sell"
    assert result.stances[0].is_conditional is True


def test_fill_missing_stance_not_conditional_when_a_backing_mention_is_firm():
    result = parse_analysis_payload({
        "mentions": [
            {"ticker": "AMD", "start_seconds": 1.0, "quote": "q1", "stance": "sell",
             "reasoning": "r", "is_conditional": True, "condition": "at 625+"},
            {"ticker": "AMD", "start_seconds": 2.0, "quote": "q2", "stance": "sell",
             "reasoning": "r", "is_conditional": False, "condition": None},
        ],
        "stances": [],
    })
    assert result.stances[0].is_conditional is False


# ---- tldr (whole-video takeaways) ----


def test_parse_payload_tldr_happy_path():
    result = parse_analysis_payload({
        "mentions": [], "stances": [],
        "tldr": ["Expects two more Fed cuts", "Rotating into small caps"],
    })
    assert result.tldr == ("Expects two more Fed cuts", "Rotating into small caps")


def test_parse_payload_tldr_missing_or_malformed_is_none():
    # Lenient like the other newer fields: never fail the whole analysis over tldr.
    assert parse_analysis_payload({"mentions": [], "stances": []}).tldr is None
    assert parse_analysis_payload(
        {"mentions": [], "stances": [], "tldr": "not a list"}
    ).tldr is None
    assert parse_analysis_payload(
        {"mentions": [], "stances": [], "tldr": [42, "", "   "]}
    ).tldr is None


def test_parse_payload_tldr_keeps_only_nonempty_strings():
    result = parse_analysis_payload(
        {"mentions": [], "stances": [], "tldr": ["keep me", 42, ""]}
    )
    assert result.tldr == ("keep me",)


def test_fake_results_include_tldr():
    from app.analysis.llm import _FAKE_RESULTS

    for vid in ("alpha_vid_3", "alpha_vid_2", "beta_vid_3", "beta_vid_2"):
        assert _FAKE_RESULTS[vid].tldr, vid
    assert AnalysisResult.empty().tldr is None
