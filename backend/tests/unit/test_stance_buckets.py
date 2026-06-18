from datetime import datetime, timedelta, timezone

from app.api.stance_buckets import bucket_channel_stances

NOW = datetime(2026, 6, 18, 12, 0, tzinfo=timezone.utc)


def test_bucket_counts_match_window_granularity():
    # span -> (expected number of buckets, expected granularity)
    cases = {7: (7, "day"), 30: (4, "week"), 90: (12, "week"),
             180: (6, "month"), 365: (12, "month")}
    for span, (n, gran) in cases.items():
        out = bucket_channel_stances([], NOW, span)
        assert len(out) == n, f"span={span}"
        assert all(b["granularity"] == gran for b in out), f"span={span}"


def test_quarter_granularity_for_multi_year_span():
    # >730d effective span -> quarterly buckets (the All-time path can reach this)
    out = bucket_channel_stances([], NOW, 800)
    assert len(out) == 800 // 91  # rolling 91-day buckets
    assert all(b["granularity"] == "quarter" for b in out)


def test_buckets_are_oldest_to_newest_and_contiguous():
    out = bucket_channel_stances([], NOW, 30)
    starts = [b["start"] for b in out]
    assert starts == sorted(starts)            # oldest first
    # last bucket ends at now
    assert out[-1]["end"] == NOW.isoformat()


def test_channel_counted_once_per_bucket_under_most_recent_stance():
    # one channel, two stances in the SAME week -> counts once, under the newest (sell)
    rows = [
        ("chA", "buy", NOW - timedelta(days=3)),
        ("chA", "sell", NOW - timedelta(days=1)),
    ]
    out = bucket_channel_stances(rows, NOW, 30)  # weekly buckets
    last = out[-1]
    assert (last["buy"], last["neutral"], last["sell"]) == (0, 0, 1)


def test_same_channel_counts_in_multiple_buckets_over_time():
    rows = [
        ("chA", "buy", NOW - timedelta(days=1)),    # newest week
        ("chA", "sell", NOW - timedelta(days=15)),  # ~2 weeks earlier
    ]
    out = bucket_channel_stances(rows, NOW, 30)
    totals = [(b["buy"] + b["neutral"] + b["sell"]) for b in out]
    assert sum(totals) == 2  # appears in two different buckets


def test_distinct_channels_counted_separately():
    rows = [
        ("chA", "buy", NOW - timedelta(days=1)),
        ("chB", "buy", NOW - timedelta(days=1)),
        ("chB", "buy", NOW - timedelta(days=2)),  # same channel again -> still once
    ]
    out = bucket_channel_stances(rows, NOW, 30)
    assert out[-1]["buy"] == 2


def test_rows_outside_window_are_ignored():
    rows = [("chA", "buy", NOW - timedelta(days=400))]
    out = bucket_channel_stances(rows, NOW, 90)
    assert all(b["buy"] == 0 for b in out)
