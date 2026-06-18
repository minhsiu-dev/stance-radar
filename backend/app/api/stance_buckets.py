"""Pure helper: bucket (channel_id, stance, published_at) rows into adaptive
time buckets, counting distinct channels per bucket under their most-recent
stance in that bucket. No DB / FastAPI dependencies — unit-tested in isolation."""

from datetime import datetime, timedelta
from typing import Iterable

_DAY = 86400.0


def _granularity(span_days: int) -> tuple[int, str]:
    """(bucket size in days, granularity label) for an effective window span."""
    if span_days <= 14:
        return 1, "day"
    if span_days <= 90:
        return 7, "week"
    if span_days <= 730:
        return 30, "month"
    return 91, "quarter"


def bucket_channel_stances(
    rows: Iterable[tuple[str, str, datetime]],
    now: datetime,
    span_days: int,
) -> list[dict]:
    size, gran = _granularity(span_days)
    n = max(1, span_days // size)
    horizon = now - timedelta(days=n * size)
    # j = 0 is the newest bucket; store most-recent (stance, ts) per channel per bucket
    per_bucket: list[dict[str, tuple[str, datetime]]] = [dict() for _ in range(n)]
    for channel_id, stance, ts in rows:
        if ts <= horizon or ts > now:
            continue
        j = int((now - ts).total_seconds() // (size * _DAY))
        if j >= n:
            continue
        prev = per_bucket[j].get(channel_id)
        if prev is None or ts >= prev[1]:
            per_bucket[j][channel_id] = (stance, ts)

    out: list[dict] = []
    for j in range(n - 1, -1, -1):  # oldest -> newest
        end = now - timedelta(days=j * size)
        start = end - timedelta(days=size)
        counts = {"buy": 0, "neutral": 0, "sell": 0}
        for stance, _ in per_bucket[j].values():
            counts[stance] += 1
        out.append({
            "start": start.isoformat(),
            "end": end.isoformat(),
            "granularity": gran,
            **counts,
        })
    return out
