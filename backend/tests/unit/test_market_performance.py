from datetime import date

from app.market.performance import change_percent, slice_for_range


def test_slice_for_range_date_based():
    values = [(date(2026, m, 1), float(m)) for m in range(1, 7)]
    out = slice_for_range(values, "3m", today=date(2026, 6, 12))
    # start = today - 93 days = 2026-03-11 -> first bar >= that date is 4/1
    assert out[0] == (date(2026, 4, 1), 4.0)
    assert out[-1] == (date(2026, 6, 1), 6.0)


def test_slice_for_range_ytd():
    values = [(date(2025, 12, 31), 1.0), (date(2026, 1, 2), 2.0),
              (date(2026, 3, 1), 3.0)]
    out = slice_for_range(values, "ytd", today=date(2026, 6, 12))
    assert out[0] == (date(2026, 1, 2), 2.0)


def test_slice_for_range_5d_takes_last_six_bars():
    values = [(date(2026, 6, d), float(d)) for d in range(1, 13)]
    out = slice_for_range(values, "5d", today=date(2026, 6, 12))
    assert len(out) == 6 and out[0][1] == 7.0


def test_change_percent():
    values = [(date(2026, 6, 1), 100.0), (date(2026, 6, 2), 110.0)]
    assert change_percent(values) == 10.0


def test_change_percent_insufficient_data():
    assert change_percent([]) is None
    assert change_percent([(date(2026, 6, 1), 100.0)]) is None
