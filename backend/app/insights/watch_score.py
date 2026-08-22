"""Pure scoring for the /stocks trending ranking: recency momentum x cross-channel
breadth x channel quality. No DB, no FastAPI, no market data — unit-tested in
isolation (tests/unit/test_watch_score.py).

    v_c   = SUM over channel c's buy videos in the window of 0.5 ** (age_days / H)
    w_c   = 1 + (win_rate/100 - 0.5) * n / (n + K)
    score = SUM over channels of w_c * sqrt(v_c)

sqrt(v_c) is what makes breadth beat volume: one channel posting 4 videos scores
the same as two channels posting one each, so a single channel cannot spam its way
to the top. The half-life makes "推薦" mean *recently* recommended. w_c shrinks
toward 1.0 as n falls, so a channel with two lucky calls gets no real boost.
"""
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Sequence

# Half-life of a single video's contribution. 7 (the old unused _TRENDING_HALF_LIFE_DAYS)
# is too aggressive for a 90-day window: a 60-day-old video would weigh 0.0002.
HALF_LIFE_DAYS = 14.0

# Shrinkage strength for the win-rate weight: at n == K the channel gets half of its
# deviation from neutral. Calibrated against this tool's real per-channel matured-call
# counts (0..155) — see the spec.
SHRINK_K = 10.0

_SECONDS_PER_DAY = 86400.0


@dataclass(frozen=True)
class ChannelBuys:
    """One channel's buy videos for a single ticker inside the counting window."""

    channel_id: str
    published_ats: tuple[datetime, ...]
    win_rate: float | None = None  # 0-100, from summarize_channel_calls' buy["90"]
    win_rate_n: int = 0


@dataclass(frozen=True)
class WatchScore:
    score: float
    # sqrt(v_c)-weighted mean win rate over the channels that have one; None if none do.
    win_rate_avg: float | None


def decay(published_at: datetime, now: datetime) -> float:
    """Exponential recency weight in (0, 1]. Clamped at 1.0 so clock skew (a video
    timestamped in the future) cannot earn more than a brand-new video."""
    age_days = max((now - published_at).total_seconds() / _SECONDS_PER_DAY, 0.0)
    return 0.5 ** (age_days / HALF_LIFE_DAYS)


def channel_volume(channel: ChannelBuys, now: datetime) -> float:
    return sum(decay(p, now) for p in channel.published_ats)


def channel_weight(win_rate: float | None, n: int) -> float:
    """Win-rate weight in [0.5, 1.5], shrunk toward 1.0 by sample size.

    No win rate (channel has no matured buy calls, or price data is missing) -> 1.0,
    i.e. the channel counts exactly as much as it did before weighting existed. This
    is why no caller needs a special case for unscored channels.
    """
    if win_rate is None or n <= 0:
        return 1.0
    return 1.0 + (win_rate / 100.0 - 0.5) * (n / (n + SHRINK_K))


def compute_watch_score(
    channels: Sequence[ChannelBuys],
    now: datetime,
    weighted: bool = True,
) -> WatchScore:
    score = 0.0
    rate_num = 0.0
    rate_den = 0.0
    for ch in channels:
        root = math.sqrt(channel_volume(ch, now))
        weight = channel_weight(ch.win_rate, ch.win_rate_n) if weighted else 1.0
        score += weight * root
        if ch.win_rate is not None:
            rate_num += root * ch.win_rate
            rate_den += root
    avg = round(rate_num / rate_den, 1) if rate_den > 0 else None
    return WatchScore(score=score, win_rate_avg=avg)
