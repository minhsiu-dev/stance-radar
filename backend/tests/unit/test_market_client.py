import pytest
from datetime import date
from unittest.mock import patch
import pandas as pd

from app.market.client import (
    RANGE_TO_FETCH,
    Candle,
    FakeMarketClient,
    FinancialReport,
    SearchHit,
    StockNotFound,
    StockSummary,
    YFinanceMarketClient,
)


def test_range_to_fetch_table_covers_intraday_and_daily():
    from app.market.client import RANGE_TO_FETCH

    assert RANGE_TO_FETCH["1d"] == ("1d", "5m")
    assert RANGE_TO_FETCH["5d"] == ("5d", "30m")
    assert RANGE_TO_FETCH["1m"] == ("1mo", "1d")
    assert RANGE_TO_FETCH["3m"] == ("3mo", "1d")
    assert RANGE_TO_FETCH["6m"] == ("6mo", "1d")
    assert RANGE_TO_FETCH["ytd"] == ("ytd", "1d")
    assert RANGE_TO_FETCH["1y"] == ("1y", "1d")
    assert RANGE_TO_FETCH["3y"] == ("3y", "1d")
    assert RANGE_TO_FETCH["5y"] == ("5y", "1d")


def test_range_map_covers_spec_ranges():
    assert set(RANGE_TO_FETCH) == {"1d", "5d", "1m", "3m", "6m", "ytd", "1y", "3y", "5y"}


async def test_fake_known_ticker_summary():
    client = FakeMarketClient()
    summary = await client.get_summary("AAPL")
    assert isinstance(summary, StockSummary)
    assert summary.ticker == "AAPL"
    assert summary.price is not None


async def test_fake_unknown_ticker_raises():
    client = FakeMarketClient()
    assert await client.ticker_exists("ZZZZ") is False
    with pytest.raises(StockNotFound):
        await client.get_summary("ZZZZ")


async def test_fake_candles_deterministic_and_sorted():
    client = FakeMarketClient()
    candles = await client.get_candles("AAPL", "3m")
    again = await client.get_candles("AAPL", "3m")
    assert candles == again
    assert all(isinstance(c, Candle) for c in candles)
    times = [c.time for c in candles]
    assert times == sorted(times)
    assert len(candles) == 65


async def test_fake_market_client_daily_candle_uses_iso_date_string():
    from app.market.client import FakeMarketClient

    candles = await FakeMarketClient().get_candles("AAPL", "1y")
    assert candles
    assert isinstance(candles[-1].time, str)
    assert len(candles[-1].time) == 10  # YYYY-MM-DD


async def test_fake_market_client_intraday_candle_uses_unix_seconds():
    from app.market.client import FakeMarketClient

    candles = await FakeMarketClient().get_candles("AAPL", "1d")
    assert candles
    assert isinstance(candles[-1].time, int)
    assert candles[-1].time > 1_700_000_000  # plausible epoch


async def test_yfinance_summary_uses_cache(monkeypatch):
    client = YFinanceMarketClient()
    calls = {"n": 0}

    def fake_fetch(ticker: str) -> StockSummary:
        calls["n"] += 1
        return StockSummary(
            ticker=ticker, name="Apple Inc.", price=190.0, change=1.0,
            change_percent=0.53, market_cap=2.9e12, pe_ratio=29.5, forward_pe=25.1,
            eps=6.44, week52_high=210.0, week52_low=160.0, volume=50_000_000,
            dividend_yield=0.55,
        )

    monkeypatch.setattr(client, "_fetch_summary", fake_fetch)
    await client.get_summary("AAPL")
    await client.get_summary("AAPL")
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_fake_search_matches_ticker_substring():
    client = FakeMarketClient()
    hits = await client.search("AAP")
    assert any(h.ticker == "AAPL" for h in hits)


@pytest.mark.asyncio
async def test_fake_search_matches_name_substring():
    client = FakeMarketClient()
    hits = await client.search("Tesla")
    assert any(h.ticker == "TSLA" for h in hits)


@pytest.mark.asyncio
async def test_fake_search_empty_returns_empty_list():
    client = FakeMarketClient()
    assert await client.search("ZZZZZ") == []


def test_search_hit_is_frozen():
    hit = SearchHit(ticker="AAPL", name="Apple Inc.", exchange="NASDAQ")
    with pytest.raises(Exception):
        hit.ticker = "X"  # type: ignore[misc]


@pytest.mark.asyncio
async def test_yfinance_search_maps_quotes():
    client = YFinanceMarketClient()
    fake = type("S", (), {"quotes": [
        {"symbol": "AAPL", "shortname": "Apple Inc.", "exchange": "NMS"},
        {"symbol": None, "shortname": "garbage"},
    ]})
    with patch("yfinance.Search", return_value=fake):
        hits = await client.search("apple")
    assert len(hits) == 1
    assert hits[0].ticker == "AAPL"
    assert hits[0].name == "Apple Inc."


@pytest.mark.asyncio
async def test_yfinance_search_handles_upstream_exception():
    client = YFinanceMarketClient()
    with patch("yfinance.Search", side_effect=RuntimeError("rate limit")):
        hits = await client.search("apple")
    assert hits == []


@pytest.mark.asyncio
async def test_fake_financials_quarterly_returns_8():
    client = FakeMarketClient()
    reports = await client.get_financials("AAPL", "quarterly")
    assert len(reports) == 8
    assert reports[0].period_end < reports[-1].period_end


@pytest.mark.asyncio
async def test_fake_financials_annual_returns_5():
    client = FakeMarketClient()
    reports = await client.get_financials("AAPL", "annual")
    assert len(reports) == 5


@pytest.mark.asyncio
async def test_fake_financials_metrics_present():
    client = FakeMarketClient()
    reports = await client.get_financials("AAPL", "quarterly")
    sample = reports[-1]
    assert sample.total_revenue is not None
    assert sample.net_income is not None
    assert sample.gross_profit is not None
    assert sample.operating_income is not None
    assert sample.pretax_income is not None


@pytest.mark.asyncio
async def test_fake_financials_unknown_ticker():
    client = FakeMarketClient()
    with pytest.raises(StockNotFound):
        await client.get_financials("ZZZZ", "quarterly")


@pytest.mark.asyncio
async def test_yfinance_financials_quarterly_takes_up_to_8():
    client = YFinanceMarketClient()
    cols = pd.to_datetime([f"2024-{m:02d}-30" for m in (3, 6, 9, 12)])
    df = pd.DataFrame(
        {
            cols[0]: [100, 40, 25, 24, 20],
            cols[1]: [110, 44, 27, 26, 22],
            cols[2]: [120, 48, 29, 28, 24],
            cols[3]: [130, 52, 31, 30, 26],
        },
        index=[
            "Total Revenue",
            "Gross Profit",
            "Operating Income",
            "Pretax Income",
            "Net Income",
        ],
    )

    class T:
        quarterly_income_stmt = df
        income_stmt = df

    with patch("yfinance.Ticker", return_value=T()):
        reports = await client.get_financials("AAPL", "quarterly")
    assert len(reports) == 4
    assert reports[0].period_end == "2024-03-30"
    assert reports[-1].total_revenue == 130


@pytest.mark.asyncio
async def test_yfinance_financials_handles_missing_row():
    client = YFinanceMarketClient()
    df = pd.DataFrame(
        {pd.Timestamp("2024-12-31"): [100, 22]},
        index=["Total Revenue", "Net Income"],
    )

    class T:
        quarterly_income_stmt = df
        income_stmt = df

    with patch("yfinance.Ticker", return_value=T()):
        reports = await client.get_financials("AAPL", "annual")
    assert reports[0].total_revenue == 100
    assert reports[0].gross_profit is None


@pytest.mark.asyncio
async def test_yfinance_financials_empty_raises_not_found():
    client = YFinanceMarketClient()

    class T:
        quarterly_income_stmt = pd.DataFrame()
        income_stmt = pd.DataFrame()

    with patch("yfinance.Ticker", return_value=T()):
        with pytest.raises(StockNotFound):
            await client.get_financials("AAPL", "quarterly")


def test_fake_market_client_summary_includes_forward_pe():
    import asyncio
    from app.market.client import FakeMarketClient

    client = FakeMarketClient()
    summary = asyncio.run(client.get_summary("AAPL"))
    assert summary.forward_pe is not None
    assert summary.forward_pe == round(summary.pe_ratio * 0.85, 4)


async def test_fake_daily_history_is_deterministic_and_weekdays_only():
    fake = FakeMarketClient()
    out = await fake.get_daily_history(
        ["AAPL", "VOO"], date(2026, 5, 1), date(2026, 5, 31)
    )
    assert set(out) == {"AAPL", "VOO"}
    aapl = out["AAPL"]
    assert all(date.fromisoformat(c.time).weekday() < 5 for c in aapl)
    # the same day's close is consistent across calls (the store's overlap comparison relies on this)
    again = await fake.get_daily_history(["AAPL"], date(2026, 5, 15), date(2026, 5, 31))
    by_date = {c.time: c.close for c in again["AAPL"]}
    for c in aapl:
        if c.time in by_date:
            assert by_date[c.time] == c.close


async def test_fake_daily_history_unknown_ticker_returns_empty():
    fake = FakeMarketClient()
    out = await fake.get_daily_history(["ZZZZ"], date(2026, 5, 1), date(2026, 5, 10))
    assert out["ZZZZ"] == []


async def test_fake_analyst_is_deterministic_and_complete():
    fake = FakeMarketClient()
    a = await fake.get_analyst("AAPL")
    assert a.target_low is not None and a.target_low < a.target_mean < a.target_high
    assert a.analyst_count and a.analyst_count > 0
    assert set(a.recommendations) == {"strongBuy", "buy", "hold", "sell", "strongSell"}
    assert a == await fake.get_analyst("AAPL")
    empty = await fake.get_analyst("ZZZZ")
    assert empty.target_mean is None and empty.recommendations == {}


async def test_yfinance_analyst_parses_info_and_recommendations(monkeypatch):
    import pandas as pd

    from app.market.client import YFinanceMarketClient

    class FakeTicker:
        def __init__(self, ticker):
            self.info = {
                "targetLowPrice": 100.0, "targetMeanPrice": 150.0,
                "targetHighPrice": 200.0, "numberOfAnalystOpinions": 30,
            }
            self.recommendations_summary = pd.DataFrame([
                {"period": "0m", "strongBuy": 10, "buy": 12, "hold": 6,
                 "sell": 1, "strongSell": 1},
                {"period": "-1m", "strongBuy": 9, "buy": 11, "hold": 7,
                 "sell": 2, "strongSell": 1},
            ])

    import yfinance

    monkeypatch.setattr(yfinance, "Ticker", FakeTicker)
    a = YFinanceMarketClient()._fetch_analyst("aapl")
    assert a.target_mean == 150.0 and a.analyst_count == 30
    assert a.recommendations == {
        "strongBuy": 10, "buy": 12, "hold": 6, "sell": 1, "strongSell": 1,
    }


import pytest
from app.market.client import YFinanceMarketClient, StockSummary
from app.net.proxy import ProxyRotator


class _CountingRotator(ProxyRotator):
    def __init__(self):
        super().__init__("")
        self.rotations = 0

    async def rotate(self):
        self.rotations += 1


def _summary(t):
    return StockSummary(
        ticker=t, name=t, price=1.0, change=0.0, change_percent=0.0,
        market_cap=0.0, pe_ratio=None, forward_pe=None, eps=None,
        week52_high=None, week52_low=None, volume=None, dividend_yield=None,
    )


async def test_market_rotates_on_rate_limit_then_succeeds(monkeypatch):
    monkeypatch.setattr("yfinance.set_config", lambda **kw: None)
    rot = _CountingRotator()
    client = YFinanceMarketClient(proxy_url="http://proxy:8888", rotator=rot)
    calls = {"n": 0}

    def fake_fetch(ticker):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("429 Too Many Requests")
        return _summary(ticker)

    monkeypatch.setattr(client, "_fetch_summary", fake_fetch)
    out = await client.get_summary("AAPL")
    assert out.ticker == "AAPL"
    assert rot.rotations == 1 and calls["n"] == 2


async def test_market_no_proxy_does_not_rotate(monkeypatch):
    rot = _CountingRotator()
    client = YFinanceMarketClient(proxy_url="", rotator=rot)

    def fake_fetch(ticker):
        raise RuntimeError("429 Too Many Requests")

    monkeypatch.setattr(client, "_fetch_summary", fake_fetch)
    with pytest.raises(RuntimeError):
        await client.get_summary("AAPL")
    assert rot.rotations == 0


async def test_market_sets_yfinance_proxy(monkeypatch):
    captured = {}
    monkeypatch.setattr("yfinance.set_config", lambda **kw: captured.update(kw))
    YFinanceMarketClient(proxy_url="http://proxy:8888")
    assert captured.get("proxy") == "http://proxy:8888"
