"""Portfolio range performance: "current-holdings backtest" -- current share count x historical closes.

Buys/sells within the period don't affect the curve (a spec decision); the upside is direct comparability with VOO/QQQ.
The portfolio start = the max over each holding's first daily candle (decided by the latest-listed one); missing days are forward-filled.
"""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.market.client import Candle
# Re-exported for app.api.portfolio (which still imports these from here until Task B4)
from app.market.performance import (  # noqa: F401
    PERFORMANCE_RANGES, RANGE_DAYS, change_percent, slice_for_range,
)


@dataclass(frozen=True)
class SeriesPoint:
    date: str
    value: float


def _daily(bars: list[Candle]) -> list[tuple[date, float]]:
    return [
        (date.fromisoformat(c.time), c.close)
        for c in bars
        if isinstance(c.time, str)
    ]


def portfolio_values(
    holdings: dict[str, Decimal],
    bars_by_ticker: dict[str, list[Candle]],
    cash: float = 0.0,
) -> list[tuple[date, float]]:
    series = {t: _daily(bars_by_ticker.get(t, [])) for t in holdings}
    # Holdings with no price data at all (delisted/not found) are excluded from the backtest, so the whole series can still be computed
    series = {t: s for t, s in series.items() if s}
    if not series:
        return []
    start = max(s[0][0] for s in series.values())
    all_dates = sorted({d for s in series.values() for d, _ in s if d >= start})
    iters = {t: 0 for t in series}
    last_close: dict[str, float] = {}
    out: list[tuple[date, float]] = []
    for d in all_dates:
        for t, s in series.items():
            i = iters[t]
            while i < len(s) and s[i][0] <= d:
                last_close[t] = s[i][1]
                i += 1
            iters[t] = i
        total = cash + sum(
            float(holdings[t]) * last_close[t]
            for t in series
            if t in last_close
        )
        out.append((d, round(total, 2)))
    return out


def normalize(values: list[tuple[date, float]]) -> list[SeriesPoint]:
    if not values or values[0][1] == 0:
        return []
    base = values[0][1]
    return [
        SeriesPoint(date=d.isoformat(), value=round(v / base * 100, 2))
        for d, v in values
    ]
