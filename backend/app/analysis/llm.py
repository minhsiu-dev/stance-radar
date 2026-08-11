import asyncio
import functools
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


class AnalysisInfrastructureError(AnalysisError):
    """The claude child was killed by a signal — the spawning process is broken, not the video.

    Observed as `claude exited -11` (SIGSEGV) with empty stderr, ~15ms after exec: a
    long-lived uvicorn process can degrade until every child it forks dies before exec
    (reproduced with /bin/true, so it is not specific to the claude binary). The breakage
    latches, so retrying inside this process is pointless — the caller must abort and let a
    fresh process take over.
    """


class LLMClient(Protocol):
    async def analyze(
        self, *, video_id: str, video_title: str, transcript: Transcript
    ) -> AnalysisResult: ...


def _parse_enum_field(item: dict, key: str, valid: frozenset[str]) -> str | None:
    """Lenient parsing for newer fields: missing or invalid value -> None, so the whole video analysis doesn't fail."""
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
    is_conditional = item.get("is_conditional")
    if not isinstance(is_conditional, bool):
        is_conditional = None
    return StanceResult(
        ticker, stance, summary,
        confidence=_parse_enum_field(item, "confidence", VALID_CONFIDENCE),
        is_conditional=is_conditional,
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
        # conditional only if EVERY mention backing the chosen stance is conditional
        backing = [m for m in ticker_mentions if m.stance == stance]
        is_conditional = bool(backing) and all(
            m.is_conditional is True for m in backing
        )
        filled.append(StanceResult(
            ticker=ticker, stance=stance, summary=ticker_mentions[0].reasoning,
            is_conditional=is_conditional,
        ))
    return tuple(filled)


def _parse_tldr(payload: dict) -> tuple[str, ...] | None:
    """Lenient like _parse_enum_field: a missing/malformed tldr must not fail the analysis."""
    value = payload.get("tldr")
    if not isinstance(value, list):
        return None
    items = tuple(s.strip() for s in value if isinstance(s, str) and s.strip())
    return items or None


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
        mentions=mentions,
        stances=_fill_missing_stances(mentions, stances),
        tldr=_parse_tldr(payload),
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
        "Return ONLY a single JSON object matching the schema below — no markdown "
        "wrapping, and no text before or after it:\n"
        f"{schema}\n"
    )


async def _communicate(proc, stdin_data: bytes) -> tuple[int, bytes, bytes]:
    """communicate() that tolerates the child dying before it drains stdin.

    asyncio's own communicate() feeds stdin and reads stdout/stderr in one gather, so
    a failed write tears down the whole thing and discards the child's output — which
    is exactly the diagnosis when the child died early. Feeding stdin as its own task
    keeps the reads intact whatever stdin does. Worth tolerating rather than trusting
    the write: stdlib asyncio swallows the BrokenPipeError, while uvloop (what uvicorn
    serves on) raises RuntimeError from the already-closed transport.
    """

    async def feed() -> None:
        try:
            proc.stdin.write(stdin_data)
            await proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError, RuntimeError):
            pass
        finally:
            try:
                proc.stdin.close()
            except (BrokenPipeError, ConnectionResetError, RuntimeError):
                pass

    _, stdout, stderr = await asyncio.gather(
        feed(), proc.stdout.read(), proc.stderr.read()
    )
    await proc.wait()
    return proc.returncode, stdout, stderr


async def _default_runner(
    args: list[str], stdin_data: bytes, *, timeout: float | None = None
) -> tuple[int, bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        try:
            return await asyncio.wait_for(_communicate(proc, stdin_data), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            try:
                await proc.wait()  # reap the killed child
            except ProcessLookupError:
                pass
            logger.warning("claude analysis timed out after %ss; killed and will retry", timeout)
            raise AnalysisError(f"claude timed out after {timeout}s")
    finally:
        # Any other exception escaping _communicate (e.g. an OSError from a
        # pipe read) must not leave the child running: reap it here too.
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            try:
                await proc.wait()
            except ProcessLookupError:
                pass


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
        timeout_seconds: float | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        runner: SubprocessRunner | None = None,
    ) -> None:
        self._binary = binary
        self._model = model
        self._max_retries = max_retries
        self._sleep = sleep
        self._run = runner or functools.partial(_default_runner, timeout=timeout_seconds)

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
                if code < 0:
                    raise AnalysisInfrastructureError(
                        f"claude was killed by signal {-code} for {video_id}; "
                        "the worker process can no longer spawn children"
                    )
                if code != 0:
                    raise AnalysisError(
                        f"claude exited {code}: {stderr.decode('utf-8', 'replace')[:300]}"
                    )
                return parse_cli_stdout(stdout)
            except AnalysisInfrastructureError:
                raise
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "claude analysis attempt %s/%s failed for %s: %s",
                    attempt + 1, self._max_retries, video_id, exc,
                )
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
            is_conditional=False,
        ),),
        tldr=(
            "Apple's quarter beat expectations across the board",
            "Speaker is adding to AAPL on earnings strength",
            "Sees services margin as the key driver ahead",
        ),
    ),
    "alpha_vid_2": AnalysisResult(
        mentions=(MentionResult(
            "NVDA", 33.0, "估值太貴,我會先獲利了結輝達", "sell", "估值疑慮,建議減碼",
            confidence="medium", time_horizon="short", is_conditional=False,
        ),),
        stances=(StanceResult(
            "NVDA", "sell", "估值偏高,看空 NVDA", confidence="medium",
            is_conditional=False,
        ),),
        tldr=(
            "NVDA valuation looks stretched after the run-up",
            "Speaker is taking profits rather than adding here",
        ),
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
            is_conditional=False,
        ),),
        tldr=(
            "Tesla delivery numbers came in roughly as expected",
            "No directional call — staying on the sidelines for now",
        ),
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
            StanceResult(
                "AAPL", "buy", "持續加碼,看多 AAPL", confidence="high",
                is_conditional=False,
            ),
            StanceResult(
                "NVDA", "neutral", "等回檔,觀望 NVDA", confidence="medium",
                is_conditional=True,
            ),
        ),
        tldr=(
            "Keeps adding to AAPL as a core long-term holding",
            "Waiting for an NVDA pullback before entering",
            "Overall cautious tone on chasing momentum here",
        ),
    ),
}


class FakeLLMClient:
    """Deterministic seeded results aligned with FakeTranscriptClient / FakeYouTubeClient."""

    async def analyze(
        self, *, video_id: str, video_title: str, transcript: Transcript
    ) -> AnalysisResult:
        return _FAKE_RESULTS.get(video_id, AnalysisResult.empty())
