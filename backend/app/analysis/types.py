from dataclasses import dataclass

VALID_STANCES = frozenset({"buy", "neutral", "sell"})
VALID_CONFIDENCE = frozenset({"high", "medium", "low"})
VALID_HORIZONS = frozenset({"short", "long", "unspecified"})


@dataclass(frozen=True)
class MentionResult:
    ticker: str
    start_seconds: float
    quote: str
    stance: str  # buy | neutral | sell
    reasoning: str
    confidence: str | None = None  # high | medium | low
    time_horizon: str | None = None  # short | long | unspecified
    is_conditional: bool | None = None
    condition: str | None = None


@dataclass(frozen=True)
class StanceResult:
    ticker: str
    stance: str  # buy | neutral | sell
    summary: str
    confidence: str | None = None  # high | medium | low
    is_conditional: bool | None = None


@dataclass(frozen=True)
class AnalysisResult:
    mentions: tuple[MentionResult, ...]
    stances: tuple[StanceResult, ...]

    @staticmethod
    def empty() -> "AnalysisResult":
        return AnalysisResult(mentions=(), stances=())
