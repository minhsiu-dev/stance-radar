"""Per-channel 90-day buy win rate, batched and cached, for the /stocks watch score.

The number is deliberately THE SAME one the channel page shows
(`/api/channels/{id}/performance` -> summary.buy["90"].win_rate): calls published in
the last 180 days, each scored 90 days after publication against VOO, win = adjusted
alpha > 0. Reusing summarize_channel_calls rather than reimplementing it is what keeps
a single definition of "win rate" in the product.

Note the "90" is a HOLDING HORIZON, not a lookback window — the lookback is 180 days.
"""
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.insights.channel_perf_sql import score_all_channel_calls_lean
from app.insights.scorecard import summarize_channel_calls

# The channel page (app/api/insights.py) imports this rather than keeping its own
# 180 literal, so the two can't drift apart.
WIN_RATE_WINDOW_DAYS = 180

# One /stocks page load fans out into several trending requests (infinite scroll plus
# the other consumers). The query itself is ~30ms; this just stops us paying it per
# request. Analysis results changing a win rate a few minutes late is harmless.
CACHE_TTL_SECONDS = 300.0


@dataclass(frozen=True)
class ChannelWinRate:
    win_rate: float | None  # 0-100; None when no call has matured to 90 days
    n: int


_cache: dict[str, ChannelWinRate] | None = None
_cached_at: float = 0.0


def reset_cache() -> None:
    global _cache, _cached_at
    _cache = None
    _cached_at = 0.0


async def get_channel_win_rates(session: AsyncSession) -> dict[str, ChannelWinRate]:
    """channel_id -> its 90d buy win rate. Channels with no directional call in the
    window are ABSENT — callers should treat a missing key as "unweighted", which
    watch_score.channel_weight(None, 0) already does."""
    global _cache, _cached_at
    now = time.monotonic()
    if _cache is not None and now - _cached_at < CACHE_TTL_SECONDS:
        return _cache
    cutoff = datetime.now(timezone.utc) - timedelta(days=WIN_RATE_WINDOW_DAYS)
    per_channel = await score_all_channel_calls_lean(session, cutoff)
    rates = {}
    for channel_id, calls in per_channel.items():
        cell = summarize_channel_calls(calls)["summary"]["buy"]["90"]
        rates[channel_id] = ChannelWinRate(win_rate=cell["win_rate"], n=cell["n"])
    _cache = rates
    _cached_at = now
    return rates
