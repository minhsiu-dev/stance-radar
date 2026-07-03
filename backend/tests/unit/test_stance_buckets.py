from datetime import datetime, timedelta, timezone

from app.api.stance_buckets import bucket_channel_stances

NOW = datetime(2026, 6, 18, 12, 0, tzinfo=timezone.utc)

_FIELDS = ("buy_new", "buy_repeat", "neutral_new", "neutral_repeat",
           "sell_new", "sell_repeat")


def _sum(out, field):
    return sum(b[field] for b in out)


def test_bucket_counts_match_window_granularity():
    # span -> (expected number of buckets, expected granularity)
    cases = {7: (7, "day"), 30: (4, "week"), 90: (12, "week"),
             180: (6, "month"), 365: (12, "month")}
    for span, (n, gran) in cases.items():
        out = bucket_channel_stances([], NOW, span)
        assert len(out) == n, f"span={span}"
        assert all(b["granularity"] == gran for b in out), f"span={span}"


def test_quarter_granularity_for_multi_year_span():
    out = bucket_channel_stances([], NOW, 800)
    assert len(out) == 800 // 91  # rolling 91-day buckets
    assert all(b["granularity"] == "quarter" for b in out)


def test_buckets_are_oldest_to_newest_and_contiguous():
    out = bucket_channel_stances([], NOW, 30)
    starts = [b["start"] for b in out]
    assert starts == sorted(starts)          # oldest first
    assert out[-1]["end"] == NOW.isoformat()  # last bucket ends at now


def test_bucket_has_six_split_fields_all_zero_when_empty():
    out = bucket_channel_stances([], NOW, 30)
    for b in out:
        assert set(b.keys()) == {"start", "end", "granularity", *_FIELDS}
        assert all(b[f] == 0 for f in _FIELDS)


def test_first_mention_new_same_stance_again_is_repeat():
    # one channel, same stance twice in the SAME week -> 1 new + 1 repeat
    rows = [
        ("chA", "buy", NOW - timedelta(days=3)),
        ("chA", "buy", NOW - timedelta(days=1)),
    ]
    out = bucket_channel_stances(rows, NOW, 30)  # weekly buckets
    last = out[-1]
    assert last["buy_new"] == 1
    assert last["buy_repeat"] == 1


def test_stance_change_is_new_not_repeat():
    # buy then sell in the same week -> both "new" (a change), no repeats
    rows = [
        ("chA", "buy", NOW - timedelta(days=3)),
        ("chA", "sell", NOW - timedelta(days=1)),
    ]
    out = bucket_channel_stances(rows, NOW, 30)
    last = out[-1]
    assert (last["buy_new"], last["sell_new"]) == (1, 1)
    assert (last["buy_repeat"], last["sell_repeat"]) == (0, 0)


def test_flip_back_to_prior_stance_is_still_new():
    # buy -> sell -> buy: each differs from the immediately-previous mention,
    # so all three are "new" (the flip-back to buy is solid).
    rows = [
        ("chA", "buy", NOW - timedelta(days=20)),
        ("chA", "sell", NOW - timedelta(days=13)),
        ("chA", "buy", NOW - timedelta(days=1)),
    ]
    out = bucket_channel_stances(rows, NOW, 30)
    assert _sum(out, "buy_new") == 2
    assert _sum(out, "sell_new") == 1
    assert _sum(out, "buy_repeat") == 0
    assert _sum(out, "sell_repeat") == 0


def test_same_stance_across_buckets_earliest_is_new_later_is_repeat():
    rows = [
        ("chA", "buy", NOW - timedelta(days=1)),    # newest week (later)
        ("chA", "buy", NOW - timedelta(days=15)),   # ~2 weeks earlier (first)
    ]
    out = bucket_channel_stances(rows, NOW, 30)
    assert _sum(out, "buy_new") == 1
    assert _sum(out, "buy_repeat") == 1
    assert out[-1]["buy_repeat"] == 1  # the later mention is the repeat
    assert out[-1]["buy_new"] == 0


def test_distinct_channels_classified_independently():
    rows = [
        ("chA", "buy", NOW - timedelta(days=1)),   # chA first -> new
        ("chB", "buy", NOW - timedelta(days=1)),   # chB later -> repeat
        ("chB", "buy", NOW - timedelta(days=2)),   # chB first -> new
    ]
    out = bucket_channel_stances(rows, NOW, 30)  # all in newest week
    assert out[-1]["buy_new"] == 2      # chA + chB's earliest
    assert out[-1]["buy_repeat"] == 1   # chB's later mention


def test_unordered_input_is_sorted_internally():
    # same rows as above but shuffled: result must not depend on input order
    rows = [
        ("chB", "buy", NOW - timedelta(days=1)),
        ("chA", "buy", NOW - timedelta(days=1)),
        ("chB", "buy", NOW - timedelta(days=2)),
    ]
    out = bucket_channel_stances(rows, NOW, 30)
    assert out[-1]["buy_new"] == 2
    assert out[-1]["buy_repeat"] == 1


def test_rows_outside_window_are_ignored():
    rows = [("chA", "buy", NOW - timedelta(days=400))]
    out = bucket_channel_stances(rows, NOW, 90)
    assert all(b[f] == 0 for b in out for f in _FIELDS)
