from datetime import datetime, timezone

import pytest

from app.insights.scorecard import (
    CallScore,
    PriceSeries,
    aggregate,
    build_scorecard,
    score_call,
    _to_series,
)
from app.market.client import Candle


def daily(day: str, close: float) -> Candle:
    return Candle(time=day, open=close, high=close, low=close, close=close, volume=1)


def make_series(*pairs: tuple[str, float]) -> PriceSeries:
    return _to_series([daily(d, c) for d, c in pairs])


class StubStore:
    """duck-typed PriceStore:回傳預先寫好的日 K。"""

    def __init__(self, data: dict[str, list]):
        self._data = data

    async def get_daily(self, tickers, start):
        return {t: self._data.get(t, []) for t in tickers}


def _linear_candles(ticker: str) -> list[Candle]:
    """每天 +1 的價格序列;SPY 固定不動(alpha = raw return)。"""
    days = (
        [f"2026-01-{d:02d}" for d in range(1, 32)]
        + [f"2026-02-{d:02d}" for d in range(1, 29)]
        + [f"2026-03-{d:02d}" for d in range(1, 32)]
        + [f"2026-04-{d:02d}" for d in range(1, 31)]
    )
    if ticker == "SPY":
        return [daily(day, 100.0) for day in days]
    return [daily(day, 100.0 + i) for i, day in enumerate(days)]


def test_close_on_or_after_picks_next_trading_day():
    series = make_series(("2026-01-05", 10.0), ("2026-01-08", 12.0))
    from datetime import date

    assert series.close_on_or_after(date(2026, 1, 5)) == (date(2026, 1, 5), 10.0)
    assert series.close_on_or_after(date(2026, 1, 6)) == (date(2026, 1, 8), 12.0)
    assert series.close_on_or_after(date(2026, 1, 9)) is None


def test_to_series_skips_intraday_candles():
    candles = [
        Candle(time=1700000000, open=1, high=1, low=1, close=1.0, volume=1),
        daily("2026-01-05", 10.0),
    ]
    series = _to_series(candles)
    assert len(series.dates) == 1


def test_score_call_without_data_marks_has_data_false():
    call = CallScore(
        video_id="v", video_title="t", ticker="GONE", stance="buy",
        confidence=None, summary="s", published_at="2026-01-10T00:00:00+00:00",
    )
    from datetime import date

    scored = score_call(call, None, None, date(2026, 1, 10))
    assert scored.has_data is False
    assert scored.returns == {7: None, 30: None, 90: None}


async def test_build_scorecard_linear_market_returns_and_alpha():
    store = StubStore({
        "AAPL": _linear_candles("AAPL"),
        "GONE": [],
        "SPY": _linear_candles("SPY"),
    })
    published = datetime(2026, 1, 10, 12, 0, tzinfo=timezone.utc)
    result = await build_scorecard(store, [
        {
            "video_id": "v1", "video_title": "t1", "ticker": "AAPL",
            "stance": "buy", "confidence": "high", "summary": "s",
            "published_at": published,
        },
        {
            "video_id": "v2", "video_title": "t2", "ticker": "GONE",
            "stance": "sell", "confidence": None, "summary": "s",
            "published_at": published,
        },
    ])
    call = next(c for c in result["calls"] if c["ticker"] == "AAPL")
    # entry 2026-01-10 close=109;+7 日曆日 → 2026-01-17 close=116
    assert call["entry_price"] == 109.0
    assert call["returns"]["7"] == pytest.approx(6.42, abs=0.01)
    # SPY 不動 → alpha == raw return
    assert call["alpha"]["7"] == call["returns"]["7"]
    assert call["returns"]["30"] is not None
    assert call["returns"]["90"] is not None  # 序列到 4/30,1/10+90 → 4/10

    gone = next(c for c in result["calls"] if c["ticker"] == "GONE")
    assert gone["has_data"] is False

    aggregates = result["aggregates"]
    assert aggregates["buy"]["total"] == 1
    assert aggregates["buy"]["horizons"][7]["count"] == 1
    assert aggregates["buy"]["horizons"][7]["win_rate"] == 100.0
    # GONE 無資料 → sell 沒有已實現樣本
    assert aggregates["sell"]["horizons"][7]["count"] == 0
    assert aggregates["sell"]["horizons"][7]["avg_return"] is None


def test_aggregate_sell_win_means_price_dropped():
    win = CallScore(
        video_id="a", video_title="a", ticker="X", stance="sell",
        confidence=None, summary="s", published_at="2026-01-01T00:00:00+00:00",
        returns={7: -3.0, 30: None, 90: None},
        alpha={7: -4.0, 30: None, 90: None},
    )
    loss = CallScore(
        video_id="b", video_title="b", ticker="Y", stance="sell",
        confidence=None, summary="s", published_at="2026-01-01T00:00:00+00:00",
        returns={7: 5.0, 30: None, 90: None},
        alpha={7: None, 30: None, 90: None},
    )
    out = aggregate([win, loss])
    sell7 = out["sell"]["horizons"][7]
    assert sell7["count"] == 2
    assert sell7["avg_return"] == 1.0
    assert sell7["win_rate"] == 50.0
    assert sell7["avg_alpha"] == -4.0  # 只平均有 alpha 的樣本


async def test_build_scorecard_page_no_aggregates_voo_benchmark():
    from app.insights.scorecard import build_scorecard_page

    store = StubStore({
        "AAPL": _linear_candles("AAPL"),
        "VOO": _linear_candles("SPY"),  # flat → alpha == raw return
    })
    published = datetime(2026, 1, 10, 12, 0, tzinfo=timezone.utc)
    raw = [{
        "video_id": "v1", "video_title": "t1", "ticker": "AAPL",
        "stance": "buy", "confidence": "high", "summary": "s",
        "published_at": published,
    }]
    result = await build_scorecard_page(
        store, raw, total=5, page=2, page_size=1,
    )
    assert result["benchmark"] == "VOO"
    assert result["total"] == 5
    assert result["page"] == 2
    assert result["page_size"] == 1
    assert result["horizons"] == [7, 30, 90]
    assert "aggregates" not in result
    assert len(result["calls"]) == 1
    call = result["calls"][0]
    assert call["ticker"] == "AAPL"
    assert call["returns"]["7"] == pytest.approx(6.42, abs=0.01)
    assert call["alpha"]["7"] == call["returns"]["7"]  # flat VOO
