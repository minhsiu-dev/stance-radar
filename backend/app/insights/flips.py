"""Stance flip detection: for the same channel on the same stock, two consecutive videos with different stances -> a flip.

A reversal (buy<->sell) is the strongest signal; moving in/out of neutral is treated as turning more bullish/bearish.
"""
from dataclasses import dataclass
from datetime import datetime

_RANK = {"sell": -1, "neutral": 0, "buy": 1}


@dataclass(frozen=True)
class StancePoint:
    channel_id: str
    channel_title: str
    channel_thumbnail: str
    ticker: str
    stance: str
    summary: str
    video_id: str
    video_title: str
    published_at: datetime


@dataclass(frozen=True)
class Flip:
    channel_id: str
    channel_title: str
    channel_thumbnail: str
    ticker: str
    prev: StancePoint
    curr: StancePoint
    direction: str  # bullish | bearish
    is_reversal: bool  # buy <-> sell


def detect_flips(points: list[StancePoint]) -> list[Flip]:
    """points must contain the full history (detection needs the previous point); returns all flips, newest first."""
    ordered = sorted(
        points, key=lambda p: (p.channel_id, p.ticker, p.published_at, p.video_id)
    )
    flips: list[Flip] = []
    prev: StancePoint | None = None
    for point in ordered:
        same_pair = (
            prev is not None
            and prev.channel_id == point.channel_id
            and prev.ticker == point.ticker
        )
        if same_pair and prev.stance != point.stance:
            flips.append(Flip(
                channel_id=point.channel_id,
                channel_title=point.channel_title,
                channel_thumbnail=point.channel_thumbnail,
                ticker=point.ticker,
                prev=prev,
                curr=point,
                direction=(
                    "bullish"
                    if _RANK[point.stance] > _RANK[prev.stance]
                    else "bearish"
                ),
                is_reversal={prev.stance, point.stance} == {"buy", "sell"},
            ))
        prev = point
    flips.sort(key=lambda f: f.curr.published_at, reverse=True)
    return flips
