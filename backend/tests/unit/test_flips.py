from datetime import datetime, timezone

from app.insights.flips import StancePoint, detect_flips


def point(
    stance: str, day: int, *, channel: str = "ch1", ticker: str = "AAPL",
    video: str | None = None,
) -> StancePoint:
    return StancePoint(
        channel_id=channel, channel_title=channel, channel_thumbnail="",
        ticker=ticker, stance=stance, summary=f"{stance} summary",
        video_id=video or f"v{day}", video_title=f"video {day}",
        published_at=datetime(2026, 6, day, tzinfo=timezone.utc),
    )


def test_no_flip_when_stance_unchanged():
    assert detect_flips([point("buy", 1), point("buy", 5)]) == []


def test_reversal_buy_to_sell():
    flips = detect_flips([point("buy", 1), point("sell", 5)])
    assert len(flips) == 1
    flip = flips[0]
    assert flip.is_reversal is True
    assert flip.direction == "bearish"
    assert flip.prev.video_id == "v1"
    assert flip.curr.video_id == "v5"


def test_softening_to_neutral_is_not_reversal():
    flips = detect_flips([point("sell", 1), point("neutral", 5)])
    assert len(flips) == 1
    assert flips[0].is_reversal is False
    assert flips[0].direction == "bullish"  # sell → neutral is a shift toward bullish


def test_flips_only_within_same_channel_and_ticker():
    flips = detect_flips([
        point("buy", 1, channel="ch1"),
        point("sell", 5, channel="ch2"),  # different channel, not a flip
        point("buy", 1, channel="ch3", ticker="NVDA"),
        point("sell", 5, channel="ch3", ticker="TSLA"),  # different ticker, not a flip
    ])
    assert flips == []


def test_consecutive_flips_all_detected_and_sorted_newest_first():
    flips = detect_flips([
        point("buy", 1), point("neutral", 5), point("sell", 9),
    ])
    assert [(f.prev.stance, f.curr.stance) for f in flips] == [
        ("neutral", "sell"), ("buy", "neutral"),
    ]
    assert all(f.direction == "bearish" for f in flips)
