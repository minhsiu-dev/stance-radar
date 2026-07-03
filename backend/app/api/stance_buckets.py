"""Pure helper: bucket (channel_id, stance, published_at) rows into adaptive
time buckets. Within the window, each channel's mentions are ordered by time and
each mention is classified as "new" (the channel's first mention in the window,
or a stance change from that channel's immediately-previous mention) or "repeat"
(the same stance as the channel's previous mention), then counted per stance. No
DB / FastAPI dependencies — unit-tested in isolation."""

from datetime import datetime, timedelta
from typing import Iterable

_DAY = 86400.0
_STANCES = ("buy", "neutral", "sell")


def _granularity(span_days: int) -> tuple[int, str]:
    """(bucket size in days, granularity label) for an effective window span."""
    if span_days <= 14:
        return 1, "day"
    if span_days <= 90:
        return 7, "week"
    if span_days <= 730:
        return 30, "month"
    return 91, "quarter"


def _empty_counts() -> dict:
    return {f"{s}_{kind}": 0 for s in _STANCES for kind in ("new", "repeat")}


def bucket_channel_stances(
    rows: Iterable[tuple[str, str, datetime]],
    now: datetime,
    span_days: int,
) -> list[dict]:
    size, gran = _granularity(span_days)
    n = max(1, span_days // size)
    horizon = now - timedelta(days=n * size)

    # Keep only in-window rows, grouped per channel, so we can order each
    # channel's mentions by time and detect changes vs. its previous mention.
    per_channel: dict[str, list[tuple[datetime, str]]] = {}
    for channel_id, stance, ts in rows:
        if ts <= horizon or ts > now:
            continue
        per_channel.setdefault(channel_id, []).append((ts, stance))

    per_bucket: list[dict] = [_empty_counts() for _ in range(n)]
    for mentions in per_channel.values():
        mentions.sort(key=lambda m: m[0])  # oldest -> newest, stable on ties
        prev_stance: str | None = None
        for ts, stance in mentions:
            kind = "new" if prev_stance is None or stance != prev_stance else "repeat"
            prev_stance = stance
            j = int((now - ts).total_seconds() // (size * _DAY))
            if j >= n:
                continue
            per_bucket[j][f"{stance}_{kind}"] += 1

    out: list[dict] = []
    for j in range(n - 1, -1, -1):  # oldest -> newest
        end = now - timedelta(days=j * size)
        start = end - timedelta(days=size)
        out.append({
            "start": start.isoformat(),
            "end": end.isoformat(),
            "granularity": gran,
            **per_bucket[j],
        })
    return out
