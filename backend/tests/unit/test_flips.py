from datetime import datetime, timezone

from app.insights.flips import StancePoint, detect_flips


def point(
    stance: str, day: int, *, channel: str = "ch1", ticker: str = "AAPL",
    video: str | None = None, confidence: str | None = None,
    is_conditional: bool | None = None,
) -> StancePoint:
    return StancePoint(
        channel_id=channel, channel_title=channel, channel_thumbnail="",
        ticker=ticker, stance=stance, summary=f"{stance} summary",
        video_id=video or f"v{day}", video_title=f"video {day}",
        published_at=datetime(2026, 6, day, tzinfo=timezone.utc),
        confidence=confidence, is_conditional=is_conditional,
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


def test_low_confidence_neutral_is_ignored_as_noise():
    # buy then a passing-mention neutral (low conviction) = channel didn't change its mind
    assert detect_flips([point("buy", 1), point("neutral", 5, confidence="low")]) == []


def test_low_confidence_neutral_between_buy_and_sell_recovers_reversal():
    # a passing neutral (low) had split a real reversal; dropping it restores buy→sell
    flips = detect_flips([
        point("buy", 1),
        point("neutral", 5, confidence="low"),
        point("sell", 9),
    ])
    assert len(flips) == 1
    assert (flips[0].prev.stance, flips[0].curr.stance) == ("buy", "sell")
    assert flips[0].is_reversal is True


def test_medium_confidence_neutral_is_kept_as_real_point():
    # an explicit 'on the sidelines' call (medium/high conviction) is a real datapoint
    flips = detect_flips([point("buy", 1), point("neutral", 5, confidence="medium")])
    assert len(flips) == 1
    assert flips[0].is_reversal is False
    assert flips[0].direction == "bearish"


def test_conditional_reversal_is_flip_but_not_reversal():
    # AMD case: still holding, plans to sell at $625+ -> conditional sell
    flips = detect_flips([point("buy", 1), point("sell", 5, is_conditional=True)])
    assert len(flips) == 1
    assert flips[0].is_reversal is False    # not a firm reversal
    assert flips[0].is_conditional is True
    assert flips[0].direction == "bearish"  # still retained as a (weaker) bearish flip


def test_firm_reversal_still_reversal_and_not_conditional():
    flips = detect_flips([point("buy", 1), point("sell", 5)])
    assert flips[0].is_reversal is True
    assert flips[0].is_conditional is False
