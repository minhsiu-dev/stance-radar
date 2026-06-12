import pytest

from app.market.client import (
    RANGE_TO_PERIOD,
    Candle,
    FakeMarketClient,
    StockNotFound,
    StockSummary,
    YFinanceMarketClient,
)


def test_range_map_covers_spec_ranges():
    assert set(RANGE_TO_PERIOD) == {"3m", "6m", "1y", "3y", "5y"}


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
    dates = [c.date for c in candles]
    assert dates == sorted(dates)
    assert len(candles) == 65


async def test_yfinance_summary_uses_cache(monkeypatch):
    client = YFinanceMarketClient()
    calls = {"n": 0}

    def fake_fetch(ticker: str) -> StockSummary:
        calls["n"] += 1
        return StockSummary(
            ticker=ticker, name="Apple Inc.", price=190.0, change=1.0,
            change_percent=0.53, market_cap=2.9e12, pe_ratio=29.5, eps=6.44,
            week52_high=210.0, week52_low=160.0, volume=50_000_000,
            dividend_yield=0.55,
        )

    monkeypatch.setattr(client, "_fetch_summary", fake_fetch)
    await client.get_summary("AAPL")
    await client.get_summary("AAPL")
    assert calls["n"] == 1
