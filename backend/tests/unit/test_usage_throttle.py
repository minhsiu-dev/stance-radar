from datetime import datetime, timedelta, timezone

from app.analysis.types import UsageSnapshot, UsageWindow
from app.pipeline.usage_throttle import throttle_until

NOW = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
FIVE_HOUR_RESET = NOW + timedelta(hours=2)
SEVEN_DAY_RESET = NOW + timedelta(days=3)


def snap(h5: float | None = None, d7: float | None = None) -> UsageSnapshot:
    return UsageSnapshot(
        "allowed",
        UsageWindow(h5, FIVE_HOUR_RESET) if h5 is not None else None,
        UsageWindow(d7, SEVEN_DAY_RESET) if d7 is not None else None,
        FIVE_HOUR_RESET,
    )


def test_under_both_thresholds_does_not_throttle():
    assert throttle_until(snap(0.69, 0.79), max_5h=0.7, max_7d=0.8, now=NOW) is None


def test_five_hour_at_threshold_pauses_until_its_reset():
    assert throttle_until(snap(0.70, 0.10), max_5h=0.7, max_7d=0.8, now=NOW) == (
        FIVE_HOUR_RESET, "5-hour usage 70% >= 70%",
    )


def test_seven_day_over_threshold_pauses_until_its_reset():
    until, reason = throttle_until(snap(0.10, 0.85), max_5h=0.7, max_7d=0.8, now=NOW)
    assert until == SEVEN_DAY_RESET
    assert reason == "7-day usage 85% >= 80%"


def test_both_tripped_takes_the_later_reset():
    until, reason = throttle_until(snap(0.72, 0.85), max_5h=0.7, max_7d=0.8, now=NOW)
    assert until == SEVEN_DAY_RESET
    assert reason == "5-hour usage 72% >= 70%; 7-day usage 85% >= 80%"


def test_stale_window_is_ignored():
    stale = UsageSnapshot("allowed", UsageWindow(0.95, NOW - timedelta(minutes=1)), None, None)
    assert throttle_until(stale, max_5h=0.7, max_7d=0.8, now=NOW) is None


def test_missing_usage_or_window_does_not_throttle():
    assert throttle_until(None, max_5h=0.7, max_7d=0.8, now=NOW) is None
    assert throttle_until(snap(None, None), max_5h=0.7, max_7d=0.8, now=NOW) is None
