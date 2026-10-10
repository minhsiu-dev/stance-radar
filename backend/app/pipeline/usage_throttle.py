"""When should the analysis lane stop spending the Claude subscription?

Pure decision over the usage `claude -p` reports: pause once a window's utilization
reaches its threshold, until that window resets. The quota is shared with the user's
own interactive Claude use, so the thresholds leave headroom rather than run it dry.
"""
from datetime import datetime

from app.analysis.types import UsageSnapshot, UsageWindow


def _tripped(window: UsageWindow | None, limit: float, now: datetime) -> bool:
    # A window whose reset already passed is stale: its utilization no longer applies.
    return window is not None and window.resets_at > now and window.utilization >= limit


def throttle_until(
    usage: UsageSnapshot | None, *, max_5h: float, max_7d: float, now: datetime
) -> tuple[datetime, str] | None:
    """(resume_at, reason) when a window is at/over its threshold, else None. When both
    trip, resume at the later reset -- resuming earlier would only trip again."""
    if usage is None:
        return None
    tripped = [
        (window, limit, label)
        for window, limit, label in (
            (usage.five_hour, max_5h, "5-hour"),
            (usage.seven_day, max_7d, "7-day"),
        )
        if _tripped(window, limit, now)
    ]
    if not tripped:
        return None
    resume_at = max(window.resets_at for window, _, _ in tripped)
    reason = "; ".join(
        f"{label} usage {round(window.utilization * 100)}% >= {round(limit * 100)}%"
        for window, limit, label in tripped
    )
    return resume_at, reason
