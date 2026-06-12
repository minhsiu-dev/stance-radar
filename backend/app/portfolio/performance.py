"""組合區間績效:「現在持股回推」— 目前股數 × 歷史收盤。

期間內的加碼/賣出不影響曲線(spec 決議),好處是與 VOO/QQQ 直接可比。
組合起點 = 各持股第一根日 K 的最大值(較晚上市者決定);缺日 forward-fill。
"""
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from app.market.client import Candle

# 與 app/api/stocks.py 的日 K 區間一致;5d 以「最後 6 根」處理
RANGE_DAYS = {"1m": 31, "3m": 93, "6m": 186, "1y": 366}
PERFORMANCE_RANGES = ("1d", "5d", "1m", "3m", "6m", "ytd", "1y")


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
    holdings: dict[str, Decimal], bars_by_ticker: dict[str, list[Candle]]
) -> list[tuple[date, float]]:
    series = {t: _daily(bars_by_ticker.get(t, [])) for t in holdings}
    # 完全無價格資料的持股(下市/查無)從回推中排除,避免整條序列算不出來
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
        total = sum(
            float(holdings[t]) * last_close[t]
            for t in series
            if t in last_close
        )
        out.append((d, round(total, 2)))
    return out


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


def normalize(values: list[tuple[date, float]]) -> list[SeriesPoint]:
    if not values or values[0][1] == 0:
        return []
    base = values[0][1]
    return [
        SeriesPoint(date=d.isoformat(), value=round(v / base * 100, 2))
        for d, v in values
    ]
