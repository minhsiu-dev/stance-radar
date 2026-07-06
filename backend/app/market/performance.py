"""Pure daily-candle range math shared by market-data endpoints (e.g. the
benchmark cards). Has no portfolio dependency.

`values` is a list of (date, close) ascending by date.
"""
from datetime import date, timedelta

# Matches the daily-candle ranges in app/api/stocks.py; 5d is handled as the "last 6 bars"
RANGE_DAYS = {"1m": 31, "3m": 93, "6m": 186, "1y": 366}
PERFORMANCE_RANGES = ("1d", "5d", "1m", "3m", "6m", "ytd", "1y")


def slice_for_range(
    values: list[tuple[date, float]], range_key: str, today: date
) -> list[tuple[date, float]]:
    if range_key == "5d":
        return values[-6:]
    if range_key == "ytd":
        start = date(today.year, 1, 1)
    else:
        start = today - timedelta(days=RANGE_DAYS[range_key])
    return [(d, v) for d, v in values if d >= start]


def change_percent(values: list[tuple[date, float]]) -> float | None:
    if len(values) < 2 or values[0][1] == 0:
        return None
    return round((values[-1][1] / values[0][1] - 1) * 100, 2)
