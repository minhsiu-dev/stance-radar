from datetime import date
from decimal import Decimal

from app.market.client import Candle
from app.portfolio.performance import (
    change_percent, normalize, portfolio_values, slice_for_range,
)


def bar(day: str, close: float) -> Candle:
    return Candle(time=day, open=close, high=close, low=close,
                  close=close, volume=1)


def test_portfolio_values_sums_shares_times_close():
    values = portfolio_values(
        {"A": Decimal("2"), "B": Decimal("1")},
        {
            "A": [bar("2026-06-01", 10.0), bar("2026-06-02", 11.0)],
            "B": [bar("2026-06-01", 100.0), bar("2026-06-02", 90.0)],
        },
    )
    assert values == [
        (date(2026, 6, 1), 120.0),
        (date(2026, 6, 2), 112.0),
    ]


def test_portfolio_values_starts_at_latest_first_bar_and_forward_fills():
    values = portfolio_values(
        {"A": Decimal("1"), "B": Decimal("1")},
        {
            # B listed later than A -> series starts at B's first day
            "A": [bar("2026-06-01", 10.0), bar("2026-06-02", 11.0),
                  bar("2026-06-03", 12.0)],
            "B": [bar("2026-06-02", 100.0)],  # 6/3 missing -> carry forward 100
        },
    )
    assert values == [
        (date(2026, 6, 2), 111.0),
        (date(2026, 6, 3), 112.0),
    ]


def test_portfolio_values_empty_when_no_bars():
    assert portfolio_values({"A": Decimal("1")}, {"A": []}) == []


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


def test_change_percent_and_normalize():
    values = [(date(2026, 6, 1), 100.0), (date(2026, 6, 2), 110.0)]
    assert change_percent(values) == 10.0
    pts = normalize(values)
    assert pts[0].value == 100.0 and pts[1].value == 110.0
    assert pts[0].date == "2026-06-01"


def test_change_percent_insufficient_data():
    assert change_percent([]) is None
    assert change_percent([(date(2026, 6, 1), 100.0)]) is None


def test_portfolio_values_adds_constant_cash():
    from app.portfolio.performance import portfolio_values
    from app.market.client import Candle

    def c(day, close):
        return Candle(time=day, open=close, high=close, low=close, close=close, volume=1)

    bars = {"A": [c("2026-01-02", 100.0), c("2026-01-05", 110.0)]}
    no_cash = portfolio_values({"A": Decimal("1")}, bars)
    with_cash = portfolio_values({"A": Decimal("1")}, bars, cash=50.0)
    assert [v for _, v in no_cash] == [100.0, 110.0]
    assert [v for _, v in with_cash] == [150.0, 160.0]
