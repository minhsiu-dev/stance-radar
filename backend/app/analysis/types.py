from dataclasses import dataclass
from datetime import datetime

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
    tldr: tuple[str, ...] | None = None

    @staticmethod
    def empty() -> "AnalysisResult":
        return AnalysisResult(mentions=(), stances=())


@dataclass(frozen=True)
class UsageWindow:
    utilization: float  # 0..1 share of the window's quota used
    resets_at: datetime

    def to_json(self) -> dict:
        return {"utilization": self.utilization, "resets_at": self.resets_at.isoformat()}


@dataclass(frozen=True)
class UsageSnapshot:
    """The Claude subscription usage `claude -p` reports in its rate_limit_event."""

    status: str  # "allowed" | "rejected" | ...
    five_hour: UsageWindow | None
    seven_day: UsageWindow | None
    resets_at: datetime | None  # the window the status refers to

    def to_json(self) -> dict:
        return {
            "status": self.status,
            "five_hour": self.five_hour.to_json() if self.five_hour else None,
            "seven_day": self.seven_day.to_json() if self.seven_day else None,
            "resets_at": self.resets_at.isoformat() if self.resets_at else None,
        }


@dataclass(frozen=True)
class AnalysisResponse:
    result: AnalysisResult
    usage: UsageSnapshot | None = None
