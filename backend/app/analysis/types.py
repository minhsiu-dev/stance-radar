from dataclasses import dataclass

VALID_STANCES = frozenset({"buy", "neutral", "sell"})


@dataclass(frozen=True)
class MentionResult:
    ticker: str
    start_seconds: float
    quote: str
    stance: str  # buy | neutral | sell
    reasoning: str


@dataclass(frozen=True)
class StanceResult:
    ticker: str
    stance: str  # buy | neutral | sell
    summary: str


@dataclass(frozen=True)
class AnalysisResult:
    mentions: tuple[MentionResult, ...]
    stances: tuple[StanceResult, ...]

    @staticmethod
    def empty() -> "AnalysisResult":
        return AnalysisResult(mentions=(), stances=())
