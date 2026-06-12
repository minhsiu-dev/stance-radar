import asyncio
import logging
import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal, Protocol

from app.market.cache import TTLCache

logger = logging.getLogger(__name__)

RANGE_TO_PERIOD = {"3m": "3mo", "6m": "6mo", "1y": "1y", "3y": "3y", "5y": "5y"}


class StockNotFound(Exception):
    pass


@dataclass(frozen=True)
class StockSummary:
    ticker: str
    name: str
    price: float | None
    change: float | None
    change_percent: float | None
    market_cap: float | None
    pe_ratio: float | None
    eps: float | None
    week52_high: float | None
    week52_low: float | None
    volume: int | None
    dividend_yield: float | None


@dataclass(frozen=True)
class Candle:
    date: str  # YYYY-MM-DD
    open: float
    high: float
    low: float
    close: float
    volume: int


@dataclass(frozen=True)
class SearchHit:
    ticker: str
    name: str
    exchange: str | None


@dataclass(frozen=True)
class FinancialReport:
    period_end: str
    total_revenue: float | None
    gross_profit: float | None
    operating_income: float | None
    pretax_income: float | None
    net_income: float | None


class MarketClient(Protocol):
    async def get_summary(self, ticker: str) -> StockSummary: ...
    async def get_candles(self, ticker: str, range_key: str) -> list[Candle]: ...
    async def ticker_exists(self, ticker: str) -> bool: ...
    async def search(self, q: str) -> list[SearchHit]: ...
    async def get_financials(
        self, ticker: str, period: Literal["quarterly", "annual"]
    ) -> list[FinancialReport]: ...


class YFinanceMarketClient:
    def __init__(self) -> None:
        self._summary_cache = TTLCache(ttl_seconds=900)     # 15 分鐘
        self._candles_cache = TTLCache(ttl_seconds=3600)    # 1 小時
        self._exists_cache = TTLCache(ttl_seconds=86400)    # 1 天
        self._search_cache = TTLCache(ttl_seconds=300)      # 5 分鐘
        self._financials_cache = TTLCache(ttl_seconds=3600) # 1 小時

    async def get_summary(self, ticker: str) -> StockSummary:
        cached = self._summary_cache.get(ticker)
        if cached is not None:
            return cached
        summary = await asyncio.to_thread(self._fetch_summary, ticker)
        self._summary_cache.set(ticker, summary)
        return summary

    async def get_candles(self, ticker: str, range_key: str) -> list[Candle]:
        if range_key not in RANGE_TO_PERIOD:
            raise ValueError(f"unknown range: {range_key}")
        key = f"{ticker}:{range_key}"
        cached = self._candles_cache.get(key)
        if cached is not None:
            return cached
        candles = await asyncio.to_thread(self._fetch_candles, ticker, range_key)
        self._candles_cache.set(key, candles)
        return candles

    async def ticker_exists(self, ticker: str) -> bool:
        cached = self._exists_cache.get(ticker)
        if cached is not None:
            return cached
        exists = await asyncio.to_thread(self._check_exists, ticker)
        self._exists_cache.set(ticker, exists)
        return exists

    def _fetch_summary(self, ticker: str) -> StockSummary:
        import yfinance as yf

        info = yf.Ticker(ticker).info or {}
        price = info.get("regularMarketPrice") or info.get("currentPrice")
        if price is None:
            raise StockNotFound(ticker)
        prev_close = info.get("regularMarketPreviousClose")
        change = round(price - prev_close, 4) if prev_close else None
        change_percent = (
            round((price - prev_close) / prev_close * 100, 4) if prev_close else None
        )
        return StockSummary(
            ticker=ticker.upper(),
            name=info.get("shortName") or info.get("longName") or ticker.upper(),
            price=price,
            change=change,
            change_percent=change_percent,
            market_cap=info.get("marketCap"),
            pe_ratio=info.get("trailingPE"),
            eps=info.get("trailingEps"),
            week52_high=info.get("fiftyTwoWeekHigh"),
            week52_low=info.get("fiftyTwoWeekLow"),
            volume=info.get("regularMarketVolume") or info.get("volume"),
            dividend_yield=info.get("dividendYield"),
        )

    def _fetch_candles(self, ticker: str, range_key: str) -> list[Candle]:
        import yfinance as yf

        df = yf.Ticker(ticker).history(
            period=RANGE_TO_PERIOD[range_key], interval="1d", auto_adjust=True
        )
        if df.empty:
            raise StockNotFound(ticker)
        return [
            Candle(
                date=idx.strftime("%Y-%m-%d"),
                open=round(float(row.Open), 4),
                high=round(float(row.High), 4),
                low=round(float(row.Low), 4),
                close=round(float(row.Close), 4),
                volume=int(row.Volume),
            )
            for idx, row in zip(df.index, df.itertuples())
        ]

    def _check_exists(self, ticker: str) -> bool:
        import yfinance as yf

        try:
            return not yf.Ticker(ticker).history(period="5d").empty
        except Exception:  # yfinance 例外型別不穩定,一律視為不存在並留 log
            logger.warning("ticker_exists check failed for %s", ticker, exc_info=True)
            return False

    async def search(self, q: str) -> list[SearchHit]:
        cached = self._search_cache.get(q)
        if cached is not None:
            return cached
        hits = await asyncio.to_thread(self._fetch_search, q)
        self._search_cache.set(q, hits)
        return hits

    def _fetch_search(self, q: str) -> list[SearchHit]:
        import yfinance as yf

        try:
            quotes = yf.Search(q, max_results=10).quotes
        except Exception:
            logger.warning("search failed for %s", q, exc_info=True)
            return []
        out: list[SearchHit] = []
        for row in quotes or []:
            symbol = row.get("symbol")
            if not symbol:
                continue
            out.append(SearchHit(
                ticker=symbol.upper(),
                name=row.get("shortname") or row.get("longname") or symbol,
                exchange=row.get("exchange"),
            ))
        return out

    async def get_financials(
        self, ticker: str, period: Literal["quarterly", "annual"]
    ) -> list[FinancialReport]:
        key = f"{ticker}:{period}"
        cached = self._financials_cache.get(key)
        if cached is not None:
            return cached
        reports = await asyncio.to_thread(self._fetch_financials, ticker, period)
        self._financials_cache.set(key, reports)
        return reports

    def _fetch_financials(
        self, ticker: str, period: Literal["quarterly", "annual"]
    ) -> list[FinancialReport]:
        import yfinance as yf

        t = yf.Ticker(ticker)
        df = t.quarterly_income_stmt if period == "quarterly" else t.income_stmt
        if df is None or df.empty:
            raise StockNotFound(ticker)
        limit = 8 if period == "quarterly" else 5
        cols = list(df.columns)[:limit]

        def cell(col, row: str) -> float | None:
            if row not in df.index:
                return None
            v = df.at[row, col]
            if v != v:  # NaN check
                return None
            return float(v)

        reports = [
            FinancialReport(
                period_end=col.strftime("%Y-%m-%d") if hasattr(col, "strftime") else str(col),
                total_revenue=cell(col, "Total Revenue"),
                gross_profit=cell(col, "Gross Profit"),
                operating_income=cell(col, "Operating Income"),
                pretax_income=cell(col, "Pretax Income"),
                net_income=cell(col, "Net Income"),
            )
            for col in cols
        ]
        reports.sort(key=lambda r: r.period_end)
        return reports


_RANGE_TO_DAYS = {"3m": 65, "6m": 130, "1y": 260, "3y": 780, "5y": 1300}
_FAKE_END_DATE = date(2026, 6, 10)


class FakeMarketClient:
    """確定性假資料,測試與 USE_FAKE_ADAPTERS=true 模式使用。"""

    KNOWN = {"AAPL": "Apple Inc.", "NVDA": "NVIDIA Corporation", "TSLA": "Tesla, Inc."}

    async def ticker_exists(self, ticker: str) -> bool:
        return ticker in self.KNOWN

    async def get_summary(self, ticker: str) -> StockSummary:
        if ticker not in self.KNOWN:
            raise StockNotFound(ticker)
        base = float(100 + sum(ord(c) for c in ticker) % 150)
        return StockSummary(
            ticker=ticker, name=self.KNOWN[ticker], price=base,
            change=1.23, change_percent=round(1.23 / base * 100, 4),
            market_cap=base * 1e10, pe_ratio=27.5, eps=round(base / 27.5, 2),
            week52_high=base * 1.3, week52_low=base * 0.7,
            volume=42_000_000, dividend_yield=0.5,
        )

    async def get_candles(self, ticker: str, range_key: str) -> list[Candle]:
        if ticker not in self.KNOWN:
            raise StockNotFound(ticker)
        if range_key not in _RANGE_TO_DAYS:
            raise ValueError(f"unknown range: {range_key}")
        n = _RANGE_TO_DAYS[range_key]
        base = float(100 + sum(ord(c) for c in ticker) % 150)
        days: list[date] = []
        d = _FAKE_END_DATE
        while len(days) < n:
            if d.weekday() < 5:  # 平日
                days.append(d)
            d -= timedelta(days=1)
        days.reverse()
        candles = []
        for i, day in enumerate(days):
            close = round(base + 10 * math.sin(i / 10), 2)
            candles.append(Candle(
                date=day.strftime("%Y-%m-%d"),
                open=round(close - 0.5, 2), high=round(close + 1.0, 2),
                low=round(close - 1.0, 2), close=close, volume=1_000_000 + i,
            ))
        return candles

    async def search(self, q: str) -> list[SearchHit]:
        qu = q.upper()
        return [
            SearchHit(ticker=t, name=n, exchange="NASDAQ")
            for t, n in self.KNOWN.items()
            if qu in t or qu in n.upper()
        ]

    async def get_financials(
        self, ticker: str, period: Literal["quarterly", "annual"]
    ) -> list[FinancialReport]:
        if ticker not in self.KNOWN:
            raise StockNotFound(ticker)
        n = 8 if period == "quarterly" else 5
        base = float(50 + sum(ord(c) for c in ticker) % 100) * 1e9
        out: list[FinancialReport] = []
        for i in range(n):
            scale = 1 + i * 0.05  # +5% per period
            revenue = round(base * scale, 2)
            gross = round(revenue * 0.42, 2)
            op = round(revenue * 0.28, 2)
            pretax = round(revenue * 0.26, 2)
            net = round(revenue * 0.22, 2)
            if period == "quarterly":
                year = 2024 + i // 4
                month = ((i % 4) + 1) * 3
                period_end = f"{year}-{month:02d}-28"
            else:
                period_end = f"{2020 + i}-12-31"
            out.append(FinancialReport(
                period_end=period_end,
                total_revenue=revenue,
                gross_profit=gross,
                operating_income=op,
                pretax_income=pretax,
                net_income=net,
            ))
        return out
