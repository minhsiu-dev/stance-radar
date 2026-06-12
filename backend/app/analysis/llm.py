import asyncio
from collections import Counter
from typing import Awaitable, Callable, Protocol

from app.analysis.prompts import ANALYSIS_TOOL, SYSTEM_PROMPT, build_user_prompt
from app.analysis.types import (
    VALID_STANCES,
    AnalysisResult,
    MentionResult,
    StanceResult,
)
from app.transcripts.client import Transcript


class AnalysisError(Exception):
    pass


class LLMClient(Protocol):
    async def analyze(
        self, *, video_id: str, video_title: str, transcript: Transcript
    ) -> AnalysisResult: ...


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
    return MentionResult(ticker, start_seconds, quote, stance, reasoning)


def _parse_stance(item: dict) -> StanceResult:
    try:
        ticker = str(item["ticker"]).strip().upper()
        stance = str(item["stance"])
        summary = str(item["summary"])
    except (KeyError, TypeError) as exc:
        raise AnalysisError(f"malformed stance: {item!r}") from exc
    if not ticker or stance not in VALID_STANCES:
        raise AnalysisError(f"invalid stance values: {item!r}")
    return StanceResult(ticker, stance, summary)


def _fill_missing_stances(
    mentions: tuple[MentionResult, ...], stances: tuple[StanceResult, ...]
) -> tuple[StanceResult, ...]:
    covered = {s.ticker for s in stances}
    filled = list(stances)
    for ticker in {m.ticker for m in mentions} - covered:
        ticker_mentions = [m for m in mentions if m.ticker == ticker]
        counts = Counter(m.stance for m in ticker_mentions)
        top = counts.most_common()
        # 多數決;平手 → neutral
        stance = top[0][0] if len(top) == 1 or top[0][1] > top[1][1] else "neutral"
        filled.append(StanceResult(
            ticker=ticker, stance=stance, summary=ticker_mentions[0].reasoning
        ))
    return tuple(filled)


def parse_analysis_response(response) -> AnalysisResult:
    tool_block = next(
        (
            block
            for block in response.content
            if getattr(block, "type", None) == "tool_use"
            and getattr(block, "name", None) == "record_analysis"
        ),
        None,
    )
    if tool_block is None:
        raise AnalysisError("response has no record_analysis tool_use block")
    payload = tool_block.input
    if not isinstance(payload, dict):
        raise AnalysisError(f"tool input is not a dict: {payload!r}")
    mentions = tuple(_parse_mention(m) for m in payload.get("mentions", []))
    stances = tuple(_parse_stance(s) for s in payload.get("stances", []))
    return AnalysisResult(
        mentions=mentions, stances=_fill_missing_stances(mentions, stances)
    )


class ClaudeLLMClient:
    def __init__(
        self,
        api_key: str,
        model: str,
        max_retries: int = 3,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        from anthropic import AsyncAnthropic

        self._client = AsyncAnthropic(api_key=api_key, max_retries=0)
        self._model = model
        self._max_retries = max_retries
        self._sleep = sleep

    async def analyze(
        self, *, video_id: str, video_title: str, transcript: Transcript
    ) -> AnalysisResult:
        prompt = build_user_prompt(video_title, transcript.segments)
        last_error: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                response = await self._client.messages.create(
                    model=self._model,
                    max_tokens=4096,
                    system=SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": prompt}],
                    tools=[ANALYSIS_TOOL],
                    tool_choice={"type": "tool", "name": "record_analysis"},
                )
                return parse_analysis_response(response)
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
        ),),
        stances=(StanceResult("AAPL", "buy", "財報強勁,整體看多 AAPL"),),
    ),
    "alpha_vid_2": AnalysisResult(
        mentions=(MentionResult(
            "NVDA", 33.0, "估值太貴,我會先獲利了結輝達", "sell", "估值疑慮,建議減碼",
        ),),
        stances=(StanceResult("NVDA", "sell", "估值偏高,看空 NVDA"),),
    ),
    "alpha_vid_1": AnalysisResult.empty(),
    "beta_vid_3": AnalysisResult(
        mentions=(MentionResult(
            "TSLA", 45.0, "Tesla delivery numbers look just okay", "neutral",
            "數據中性,無方向性",
        ),),
        stances=(StanceResult("TSLA", "neutral", "交車數據中性,觀望 TSLA"),),
    ),
    "beta_vid_2": AnalysisResult(
        mentions=(
            MentionResult("AAPL", 10.0, "蘋果我持續加碼", "buy", "持續加碼,看多"),
            MentionResult("NVDA", 200.0, "輝達就觀望,等回檔", "neutral", "明確觀望"),
        ),
        stances=(
            StanceResult("AAPL", "buy", "持續加碼,看多 AAPL"),
            StanceResult("NVDA", "neutral", "等回檔,觀望 NVDA"),
        ),
    ),
}


class FakeLLMClient:
    """確定性假資料,與 FakeTranscriptClient/FakeYouTubeClient 的影片 id 對齊。"""

    async def analyze(
        self, *, video_id: str, video_title: str, transcript: Transcript
    ) -> AnalysisResult:
        return _FAKE_RESULTS.get(video_id, AnalysisResult.empty())
