import asyncio
import json
import logging
from collections import Counter
from typing import Awaitable, Callable, Protocol

from app.analysis.prompts import ANALYSIS_TOOL, SYSTEM_PROMPT, build_user_prompt
from app.analysis.types import (
    VALID_CONFIDENCE,
    VALID_HORIZONS,
    VALID_STANCES,
    AnalysisResult,
    MentionResult,
    StanceResult,
)
from app.transcripts.client import Transcript

logger = logging.getLogger(__name__)

SubprocessRunner = Callable[
    [list[str], bytes], Awaitable[tuple[int, bytes, bytes]]
]


class AnalysisError(Exception):
    pass


class LLMClient(Protocol):
    async def analyze(
        self, *, video_id: str, video_title: str, transcript: Transcript
    ) -> AnalysisResult: ...


def _parse_enum_field(item: dict, key: str, valid: frozenset[str]) -> str | None:
    """新欄位採容錯解析:缺漏或值不合法 → None,不讓整部影片分析失敗。"""
    value = item.get(key)
    if isinstance(value, str) and value in valid:
        return value
    return None


def _parse_mention(item: dict) -> MentionResult:
    try:
        ticker = str(item["ticker"]).strip().upper()
        stance = str(item["stance"])
        start_seconds = float(item["start_seconds"])
        quote = str(item["quote"])
        reasoning = str(item["reasoning"])
    except (KeyError, TypeError, ValueError) as exc:
        raise AnalysisError(f"malformed mention: {item!r}") from exc
    if not ticker or stance not in VALID_STANCES or start_seconds < 0:
        raise AnalysisError(f"invalid mention values: {item!r}")
    is_conditional = item.get("is_conditional")
    if not isinstance(is_conditional, bool):
        is_conditional = None
    condition = item.get("condition")
    condition = str(condition) if isinstance(condition, str) and condition else None
    return MentionResult(
        ticker, start_seconds, quote, stance, reasoning,
        confidence=_parse_enum_field(item, "confidence", VALID_CONFIDENCE),
        time_horizon=_parse_enum_field(item, "time_horizon", VALID_HORIZONS),
        is_conditional=is_conditional,
        condition=condition if is_conditional else None,
    )


def _parse_stance(item: dict) -> StanceResult:
    try:
        ticker = str(item["ticker"]).strip().upper()
        stance = str(item["stance"])
        summary = str(item["summary"])
    except (KeyError, TypeError) as exc:
        raise AnalysisError(f"malformed stance: {item!r}") from exc
    if not ticker or stance not in VALID_STANCES:
        raise AnalysisError(f"invalid stance values: {item!r}")
    return StanceResult(
        ticker, stance, summary,
        confidence=_parse_enum_field(item, "confidence", VALID_CONFIDENCE),
    )


def _fill_missing_stances(
    mentions: tuple[MentionResult, ...], stances: tuple[StanceResult, ...]
) -> tuple[StanceResult, ...]:
    covered = {s.ticker for s in stances}
    filled = list(stances)
    for ticker in {m.ticker for m in mentions} - covered:
        ticker_mentions = [m for m in mentions if m.ticker == ticker]
        counts = Counter(m.stance for m in ticker_mentions)
        top = counts.most_common()
        # majority vote; tie → neutral
        stance = top[0][0] if len(top) == 1 or top[0][1] > top[1][1] else "neutral"
        filled.append(StanceResult(
            ticker=ticker, stance=stance, summary=ticker_mentions[0].reasoning
        ))
    return tuple(filled)


def _strip_code_fences(text: str) -> str:
    """Some models wrap JSON in ```json ... ``` fences despite the instruction not to."""
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def parse_analysis_payload(payload: dict) -> AnalysisResult:
    if not isinstance(payload, dict):
        raise AnalysisError(f"payload is not a JSON object: {payload!r}")
    mentions = tuple(_parse_mention(m) for m in payload.get("mentions", []))
    stances = tuple(_parse_stance(s) for s in payload.get("stances", []))
    return AnalysisResult(
        mentions=mentions, stances=_fill_missing_stances(mentions, stances)
    )


def parse_cli_stdout(stdout: bytes) -> AnalysisResult:
    """Parse `claude -p --output-format json` stdout into AnalysisResult.

    The CLI wraps the model's text in `{"type": "result", "result": "..."}`. The
    model's text is the JSON payload we asked for (possibly wrapped in code fences).
    """
    try:
        wrapper = json.loads(stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AnalysisError(f"claude stdout is not JSON: {stdout[:300]!r}") from exc

    if isinstance(wrapper, dict) and "result" in wrapper:
        body = wrapper["result"]
    else:
        # Fallback: maybe the user passed --output-format text or piped raw.
        body = wrapper if isinstance(wrapper, (dict, list)) else stdout.decode("utf-8")

    if isinstance(body, str):
        cleaned = _strip_code_fences(body)
        try:
            body = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise AnalysisError(
                f"claude result text is not valid JSON: {cleaned[:300]!r}"
            ) from exc

    return parse_analysis_payload(body)


def _schema_hint() -> str:
    schema = json.dumps(ANALYSIS_TOOL["input_schema"], ensure_ascii=False)
    return (
        "請只回一個 JSON 物件,符合下列 schema,不要任何 markdown 包裝、不要任何前後說明:\n"
        f"{schema}\n"
    )


async def _default_runner(args: list[str], stdin_data: bytes) -> tuple[int, bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate(stdin_data)
    return proc.returncode, stdout, stderr


class ClaudeCLIClient:
    """Wraps `claude -p` (Claude Code CLI in non-interactive mode).

    Uses the user's local Claude Code authentication; no API key required.
    """

    def __init__(
        self,
        *,
        binary: str = "claude",
        model: str,
        max_retries: int = 3,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        runner: SubprocessRunner | None = None,
    ) -> None:
        self._binary = binary
        self._model = model
        self._max_retries = max_retries
        self._sleep = sleep
        self._run = runner or _default_runner

    def _args(self) -> list[str]:
        return [
            self._binary,
            "-p",
            "--output-format", "json",
            "--model", self._model,
        ]

    def _stdin_payload(self, video_title: str, transcript: Transcript) -> bytes:
        user_prompt = build_user_prompt(video_title, transcript.segments)
        full = f"{SYSTEM_PROMPT}\n\n{user_prompt}\n\n{_schema_hint()}"
        return full.encode("utf-8")

    async def analyze(
        self, *, video_id: str, video_title: str, transcript: Transcript
    ) -> AnalysisResult:
        stdin_payload = self._stdin_payload(video_title, transcript)
        last_error: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                code, stdout, stderr = await self._run(self._args(), stdin_payload)
                if code != 0:
                    raise AnalysisError(
                        f"claude exited {code}: {stderr.decode('utf-8', 'replace')[:300]}"
                    )
                return parse_cli_stdout(stdout)
            except Exception as exc:
                last_error = exc
                if attempt < self._max_retries - 1:
                    await self._sleep(2**attempt)
        raise AnalysisError(
            f"analysis failed for {video_id} after {self._max_retries} attempts: "
            f"{last_error}"
        ) from last_error


_FAKE_RESULTS: dict[str, AnalysisResult] = {
    "alpha_vid_3": AnalysisResult(
        mentions=(MentionResult(
            "AAPL", 12.5, "蘋果這季財報很強,我會買", "buy", "財報優於預期,明確看多",
            confidence="high", time_horizon="long", is_conditional=False,
        ),),
        stances=(StanceResult(
            "AAPL", "buy", "財報強勁,整體看多 AAPL", confidence="high",
        ),),
    ),
    "alpha_vid_2": AnalysisResult(
        mentions=(MentionResult(
            "NVDA", 33.0, "估值太貴,我會先獲利了結輝達", "sell", "估值疑慮,建議減碼",
            confidence="medium", time_horizon="short", is_conditional=False,
        ),),
        stances=(StanceResult(
            "NVDA", "sell", "估值偏高,看空 NVDA", confidence="medium",
        ),),
    ),
    "alpha_vid_1": AnalysisResult.empty(),
    "beta_vid_3": AnalysisResult(
        mentions=(MentionResult(
            "TSLA", 45.0, "Tesla delivery numbers look just okay", "neutral",
            "數據中性,無方向性",
            confidence="low", time_horizon="unspecified", is_conditional=False,
        ),),
        stances=(StanceResult(
            "TSLA", "neutral", "交車數據中性,觀望 TSLA", confidence="low",
        ),),
    ),
    "beta_vid_2": AnalysisResult(
        mentions=(
            MentionResult(
                "AAPL", 10.0, "蘋果我持續加碼", "buy", "持續加碼,看多",
                confidence="high", time_horizon="long", is_conditional=False,
            ),
            MentionResult(
                "NVDA", 200.0, "輝達就觀望,等回檔", "neutral", "明確觀望",
                confidence="medium", time_horizon="short",
                is_conditional=True, condition="等回檔再進場",
            ),
        ),
        stances=(
            StanceResult("AAPL", "buy", "持續加碼,看多 AAPL", confidence="high"),
            StanceResult("NVDA", "neutral", "等回檔,觀望 NVDA", confidence="medium"),
        ),
    ),
}


class FakeLLMClient:
    """Deterministic seeded results aligned with FakeTranscriptClient / FakeYouTubeClient."""

    async def analyze(
        self, *, video_id: str, video_title: str, transcript: Transcript
    ) -> AnalysisResult:
        return _FAKE_RESULTS.get(video_id, AnalysisResult.empty())
