"""Pure unit tests for the /stocks watch score. No DB, no fixtures.

The expected numbers are the spec's worked examples
(docs/superpowers/specs/2026-08-22-watch-score-holdings-design.md), recomputed
here rather than copied loosely: H=14, K=10, saturation=sqrt.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.insights.watch_score import (
    HALF_LIFE_DAYS,
    SHRINK_K,
    ChannelBuys,
    channel_weight,
    compute_watch_score,
)

_NOW = datetime(2026, 8, 22, 12, 0, tzinfo=timezone.utc)


def _ch(cid: str, ages_days, win_rate=None, n=0) -> ChannelBuys:
    return ChannelBuys(
        channel_id=cid,
        published_ats=tuple(_NOW - timedelta(days=a) for a in ages_days),
        win_rate=win_rate,
        win_rate_n=n,
    )


def test_constants_match_the_spec():
    assert HALF_LIFE_DAYS == 14.0
    assert SHRINK_K == 10.0


def test_four_channels_outrank_one_channel_spamming():
    """The whole point of the sqrt saturation: breadth beats volume.

    4 channels x 1 buy video, 5 days old, all 60% win rate over n=30.
    """
    spread = [_ch(f"c{i}", [5], win_rate=60, n=30) for i in range(4)]
    spam = [_ch("solo", [5, 5, 5, 5, 5, 5, 5, 5], win_rate=60, n=30)]

    assert compute_watch_score(spread, _NOW).score == pytest.approx(3.7994, abs=5e-4)
    assert compute_watch_score(spam, _NOW).score == pytest.approx(2.6866, abs=5e-4)
    assert compute_watch_score(spread, _NOW).score > compute_watch_score(spam, _NOW).score


def test_two_month_old_consensus_decays_to_a_quarter():
    """Same 4 channels, same 1 video each, but 60 days ago instead of 5."""
    stale = [_ch(f"c{i}", [60], win_rate=60, n=30) for i in range(4)]
    assert compute_watch_score(stale, _NOW).score == pytest.approx(0.9737, abs=5e-4)


def test_channel_weight_shrinks_toward_neutral_on_small_samples():
    # a 100%-win-rate channel with only 2 matured calls barely moves the needle...
    assert channel_weight(100, 2) == pytest.approx(1.0833, abs=5e-4)
    # ...and loses to a 70% channel with 155 of them
    assert channel_weight(70, 155) == pytest.approx(1.1879, abs=5e-4)
    assert channel_weight(70, 11) == pytest.approx(1.1048, abs=5e-4)
    # 50% is neutral at any sample size
    assert channel_weight(50, 999) == pytest.approx(1.0)


def test_channel_weight_is_neutral_without_a_win_rate():
    assert channel_weight(None, 0) == 1.0
    assert channel_weight(None, 500) == 1.0
    assert channel_weight(60, 0) == 1.0  # n=0 -> shrink factor 0


def test_weighted_false_ignores_win_rate_entirely():
    good = [_ch("a", [0], win_rate=90, n=200)]
    bad = [_ch("b", [0], win_rate=10, n=200)]
    assert compute_watch_score(good, _NOW, weighted=False).score == pytest.approx(1.0)
    assert compute_watch_score(bad, _NOW, weighted=False).score == pytest.approx(1.0)
    # ...but weighted=True separates them
    assert compute_watch_score(good, _NOW).score > compute_watch_score(bad, _NOW).score


def test_win_rate_avg_is_weighted_by_sqrt_volume():
    """A channel that pushed 4 videos carries twice the weight of one that pushed 1."""
    channels = [
        _ch("a", [0], win_rate=80, n=100),          # sqrt(1) = 1.0
        _ch("b", [0, 0, 0, 0], win_rate=40, n=100),  # sqrt(4) = 2.0
    ]
    res = compute_watch_score(channels, _NOW)
    assert res.win_rate_avg == pytest.approx(53.3, abs=0.05)
    assert res.score == pytest.approx(3.0909, abs=5e-4)


def test_win_rate_avg_is_none_when_no_channel_has_one():
    res = compute_watch_score([_ch("a", [0]), _ch("b", [1])], _NOW)
    assert res.win_rate_avg is None
    assert res.score > 0


def test_win_rate_avg_skips_channels_without_a_win_rate():
    channels = [_ch("a", [0], win_rate=80, n=100), _ch("b", [0])]
    assert compute_watch_score(channels, _NOW).win_rate_avg == pytest.approx(80.0)


def test_empty_input_scores_zero():
    res = compute_watch_score([], _NOW)
    assert res.score == 0.0
    assert res.win_rate_avg is None


def test_future_timestamps_do_not_exceed_full_weight():
    """Clock skew must not hand out >1.0 decay."""
    future = ChannelBuys(channel_id="c", published_ats=(_NOW + timedelta(days=3),))
    assert compute_watch_score([future], _NOW).score == pytest.approx(1.0)
