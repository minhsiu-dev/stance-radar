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
    """duck-typed PriceStore: returns pre-written daily candles."""

    def __init__(self, data: dict[str, list]):
        self._data = data

    async def get_daily(self, tickers, start):
        return {t: self._data.get(t, []) for t in tickers}


def _linear_candles(ticker: str) -> list[Candle]:
    """Price series rising +1 per day; SPY stays flat (alpha = raw return)."""
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
    assert scored.returns == {30: None, 90: None}


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
    # entry 2026-01-10 close=109; +30 calendar days -> 2026-02-09 close=139
    assert call["entry_price"] == 109.0
    assert call["returns"]["30"] == pytest.approx(27.52, abs=0.01)
    # SPY flat -> alpha == raw return
    assert call["alpha"]["30"] == call["returns"]["30"]
    assert call["returns"]["90"] is not None  # series runs to 4/30, 1/10+90 -> 4/10

    gone = next(c for c in result["calls"] if c["ticker"] == "GONE")
    assert gone["has_data"] is False

    aggregates = result["aggregates"]
    assert aggregates["buy"]["total"] == 1
    assert aggregates["buy"]["horizons"][30]["count"] == 1
    assert aggregates["buy"]["horizons"][30]["win_rate"] == 100.0
    # GONE has no data -> sell has no realized samples
    assert aggregates["sell"]["horizons"][30]["count"] == 0
    assert aggregates["sell"]["horizons"][30]["avg_return"] is None


def test_aggregate_sell_win_means_price_dropped():
    win = CallScore(
        video_id="a", video_title="a", ticker="X", stance="sell",
        confidence=None, summary="s", published_at="2026-01-01T00:00:00+00:00",
        returns={30: -3.0, 90: None},
        alpha={30: -4.0, 90: None},
    )
    loss = CallScore(
        video_id="b", video_title="b", ticker="Y", stance="sell",
        confidence=None, summary="s", published_at="2026-01-01T00:00:00+00:00",
        returns={30: 5.0, 90: None},
        alpha={30: None, 90: None},
    )
    out = aggregate([win, loss])
    sell30 = out["sell"]["horizons"][30]
    assert sell30["count"] == 2
    assert sell30["avg_return"] == 1.0
    assert sell30["win_rate"] == 50.0
    assert sell30["avg_alpha"] == -4.0  # only average samples that have alpha


async def test_build_scorecard_page_no_aggregates_voo_benchmark():
    from app.insights.scorecard import build_scorecard_page

    store = StubStore({
        "AAPL": _linear_candles("AAPL"),
        "VOO": _linear_candles("SPY"),  # flat -> alpha == raw return
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
    assert result["horizons"] == [30, 90]
    assert "aggregates" not in result
    assert len(result["calls"]) == 1
    call = result["calls"][0]
    assert call["ticker"] == "AAPL"
    assert call["returns"]["30"] == pytest.approx(27.52, abs=0.01)
    assert call["alpha"]["30"] == call["returns"]["30"]  # flat VOO


def test_score_call_without_data_has_null_now():
    from datetime import date

    call = CallScore(
        video_id="v", video_title="t", ticker="GONE", stance="buy",
        confidence=None, summary="s", published_at="2026-01-10T00:00:00+00:00",
    )
    scored = score_call(call, None, None, date(2026, 1, 10))
    assert scored.now_return is None
    assert scored.now_alpha is None


async def test_now_return_uses_latest_close():
    store = StubStore({
        "AAPL": _linear_candles("AAPL"),
        "SPY": _linear_candles("SPY"),  # flat -> alpha == raw return
    })
    published = datetime(2026, 1, 10, 12, 0, tzinfo=timezone.utc)
    result = await build_scorecard(store, [{
        "video_id": "v1", "video_title": "t1", "ticker": "AAPL",
        "stance": "buy", "confidence": "high", "summary": "s",
        "published_at": published,
    }])
    call = result["calls"][0]
    # entry 2026-01-10 close=109; latest close 2026-04-30 = 219
    # (219/109 - 1) * 100 = 100.92
    assert call["now_return"] == pytest.approx(100.92, abs=0.01)
    assert call["now_alpha"] == call["now_return"]  # flat SPY benchmark


from app.insights.scorecard import CallScore, summarize_channel_calls


def _mk_call(stance, *, now_alpha=None, alpha30=None, alpha90=None,
             now_return=None, ret30=None, ret90=None):
    call = CallScore(
        video_id="v", video_title="t", ticker="X", stance=stance,
        confidence=None, summary="s", published_at="2026-01-01T00:00:00",
    )
    call.now_alpha = now_alpha
    call.alpha = {30: alpha30, 90: alpha90}
    call.now_return = now_return
    call.returns = {30: ret30, 90: ret90}
    return call


def test_summarize_stance_adjusted_win_avg_median_and_realized():
    calls = [
        _mk_call("buy", now_alpha=5.0, alpha30=3.0, alpha90=None,
                 now_return=8.0, ret30=6.0, ret90=None),
        _mk_call("buy", now_alpha=-2.0, alpha30=-1.0, alpha90=4.0,
                 now_return=1.0, ret30=2.0, ret90=10.0),
        _mk_call("sell", now_alpha=-10.0, alpha30=2.0, alpha90=None,
                 now_return=-12.0, ret30=3.0, ret90=None),
    ]
    out = summarize_channel_calls(calls)

    assert out["counts"] == {"all": 3, "buy": 2, "sell": 1}

    # all/now: adj alpha [+5,-2,+10]; adj return [8,1,+12 (sell flips -12)]
    assert out["summary"]["all"]["now"] == {
        "win_rate": 66.7, "avg": 4.33, "median": 5.0,
        "avg_return": 7.0, "median_return": 8.0, "n": 3,
    }
    # all/30: adj alpha [+3,-1,-2]; adj return [6,2,-3 (sell flips +3)]
    assert out["summary"]["all"]["30"] == {
        "win_rate": 33.3, "avg": 0.0, "median": -1.0,
        "avg_return": 1.67, "median_return": 2.0, "n": 3,
    }
    # all/90: only the second buy is realized (alpha90=4, ret90=10)
    assert out["summary"]["all"]["90"] == {
        "win_rate": 100.0, "avg": 4.0, "median": 4.0,
        "avg_return": 10.0, "median_return": 10.0, "n": 1,
    }
    # sell/90: nothing realized
    assert out["summary"]["sell"]["90"] == {
        "win_rate": None, "avg": None, "median": None,
        "avg_return": None, "median_return": None, "n": 0,
    }
    # sell/now: stock fell 10 below VOO -> adjusted +10 -> a win for the short
    assert out["summary"]["sell"]["now"]["win_rate"] == 100.0
    assert out["summary"]["sell"]["now"]["avg"] == 10.0
    assert out["summary"]["sell"]["now"]["avg_return"] == 12.0


def test_summarize_flat_alpha_is_not_a_win():
    out = summarize_channel_calls(
        [_mk_call("buy", now_alpha=0.0, now_return=0.0)]
    )
    assert out["summary"]["buy"]["now"] == {
        "win_rate": 0.0, "avg": 0.0, "median": 0.0,
        "avg_return": 0.0, "median_return": 0.0, "n": 1,
    }


from app.insights.scorecard import build_channel_performance


async def test_build_channel_performance_vs_voo_sign_flip():
    # VOO flat (alpha == raw return); AAPL & ZZZ both rise +1/day.
    store = StubStore({
        "VOO": _linear_candles("SPY"),   # "SPY" branch returns the flat series
        "AAPL": _linear_candles("AAPL"),
        "ZZZ": _linear_candles("ZZZ"),
    })
    published = datetime(2026, 1, 10, 12, 0, tzinfo=timezone.utc)
    out = await build_channel_performance(store, [
        {"video_id": "v1", "video_title": "t", "ticker": "AAPL",
         "stance": "buy", "confidence": None, "summary": "s",
         "published_at": published},
        {"video_id": "v2", "video_title": "t", "ticker": "ZZZ",
         "stance": "sell", "confidence": None, "summary": "s",
         "published_at": published},
    ])

    assert out["benchmark"] == "VOO"
    assert out["window_days"] == 180
    assert out["horizons"] == ["now", "30", "90"]
    assert out["counts"] == {"all": 2, "buy": 1, "sell": 1}

    # Rising stock vs flat VOO -> positive alpha AND positive raw return.
    buy_now = out["summary"]["buy"]["now"]
    assert buy_now["win_rate"] == 100.0 and buy_now["n"] == 1 and buy_now["avg"] > 0
    assert buy_now["avg_return"] > 0 and buy_now["median_return"] > 0
    # Same rising stock, but it's a SELL -> adjusted alpha negative -> a loss.
    sell_now = out["summary"]["sell"]["now"]
    assert sell_now["win_rate"] == 0.0 and sell_now["n"] == 1 and sell_now["avg"] < 0
    # Mixed bag -> 1 of 2 wins.
    assert out["summary"]["all"]["now"]["win_rate"] == 50.0
