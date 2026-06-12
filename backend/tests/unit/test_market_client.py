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
    # 同一天的收盤價跨呼叫一致(store 的 overlap 比對依賴這點)
    again = await fake.get_daily_history(["AAPL"], date(2026, 5, 15), date(2026, 5, 31))
    by_date = {c.time: c.close for c in again["AAPL"]}
    for c in aapl:
        if c.time in by_date:
            assert by_date[c.time] == c.close


async def test_fake_daily_history_unknown_ticker_returns_empty():
    fake = FakeMarketClient()
    out = await fake.get_daily_history(["ZZZZ"], date(2026, 5, 1), date(2026, 5, 10))
    assert out["ZZZZ"] == []


async def test_fake_news_is_deterministic():
    fake = FakeMarketClient()
    items = await fake.get_news("AAPL")
    assert len(items) == 2
    assert all(n.ticker == "AAPL" and n.title and n.url for n in items)
    assert items == await fake.get_news("AAPL")
    assert await fake.get_news("ZZZZ") == []
