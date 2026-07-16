import asyncio
import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Protocol

from app.market.cache import TTLCache
from app.net.proxy import ProxyRotator, with_rotation

logger = logging.getLogger(__name__)


def _is_yf_blocked(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "429" in msg or "too many requests" in msg


RANGE_TO_FETCH: dict[str, tuple[str, str]] = {
    "1d":  ("1d",  "5m"),
    "5d":  ("5d",  "30m"),
    "1m":  ("1mo", "1d"),
    "3m":  ("3mo", "1d"),
    "6m":  ("6mo", "1d"),
    "ytd": ("ytd", "1d"),
    "1y":  ("1y",  "1d"),
    "3y":  ("3y",  "1d"),
    "5y":  ("5y",  "1d"),
}


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
    forward_pe: float | None
    eps: float | None
    week52_high: float | None
    week52_low: float | None
    volume: int | None
    dividend_yield: float | None


@dataclass(frozen=True)
class Candle:
    time: str | int  # "YYYY-MM-DD" for daily, unix seconds (UTC) for intraday
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


@dataclass(frozen=True)
class AnalystData:
    target_low: float | None
    target_mean: float | None
    target_high: float | None
    analyst_count: int | None
    recommendations: dict[str, int]  # strongBuy/buy/hold/sell/strongSell


_EMPTY_ANALYST = AnalystData(
    target_low=None, target_mean=None, target_high=None,
    analyst_count=None, recommendations={},
)


@dataclass(frozen=True)
class EarningsDates:
    past: list[date]  # ascending, deduped
    next_date: date | None


_EMPTY_EARNINGS = EarningsDates(past=[], next_date=None)


def split_earnings_dates(dates, today: date) -> EarningsDates:
    """Split raw (possibly duplicated, unordered) earnings dates around today."""
    uniq = sorted(set(dates))
    past = [d for d in uniq if d <= today]
    future = [d for d in uniq if d > today]
    return EarningsDates(past=past, next_date=future[0] if future else None)


class MarketClient(Protocol):
    async def get_summary(self, ticker: str) -> StockSummary: ...
    async def get_candles(self, ticker: str, range_key: str) -> list[Candle]: ...
    async def ticker_exists(self, ticker: str) -> bool: ...
    async def search(self, q: str) -> list[SearchHit]: ...
    async def get_financials(
        self, ticker: str, period: Literal["quarterly", "annual"]
    ) -> list[FinancialReport]: ...
    async def get_daily_history(
        self, tickers: list[str], start: date, end: date
    ) -> dict[str, list[Candle]]: ...
    async def get_analyst(self, ticker: str) -> AnalystData: ...
    async def get_earnings(self, ticker: str) -> EarningsDates: ...


class YFinanceMarketClient:
    def __init__(self, proxy_url: str = "", rotator: ProxyRotator | None = None) -> None:
        self._proxy_url = proxy_url
        self._rotator = rotator or ProxyRotator("")
        if proxy_url:
            import yfinance as yf
            yf.set_config(proxy=proxy_url)
        self._summary_cache = TTLCache(ttl_seconds=900)     # 15 minutes
        self._candles_cache = TTLCache(ttl_seconds=3600)    # 1 hour
        self._exists_cache = TTLCache(ttl_seconds=86400)    # 1 day
        self._search_cache = TTLCache(ttl_seconds=300)      # 5 minutes
        self._financials_cache = TTLCache(ttl_seconds=86400) # 24 hours; financials change only once a quarter
        self._analyst_cache = TTLCache(ttl_seconds=86400)  # 24 hours
        self._earnings_cache = TTLCache(ttl_seconds=43200)  # 12 hours; earnings dates rarely move

    async def _call(self, fn, *args):
        if not self._proxy_url:
            return await asyncio.to_thread(fn, *args)
        return await with_rotation(
            lambda: asyncio.to_thread(fn, *args), _is_yf_blocked, self._rotator
        )

    async def get_summary(self, ticker: str) -> StockSummary:
        cached = self._summary_cache.get(ticker)
        if cached is not None:
            return cached
        summary = await self._call(self._fetch_summary, ticker)
        self._summary_cache.set(ticker, summary)
        return summary

    async def get_candles(self, ticker: str, range_key: str) -> list[Candle]:
        if range_key not in RANGE_TO_FETCH:
            raise ValueError(f"unknown range: {range_key}")
        key = f"{ticker}:{range_key}"
        cached = self._candles_cache.get(key)
        if cached is not None:
            return cached
        candles = await self._call(self._fetch_candles, ticker, range_key)
        self._candles_cache.set(key, candles)
        return candles

    async def ticker_exists(self, ticker: str) -> bool:
        cached = self._exists_cache.get(ticker)
        if cached is not None:
            return cached
        exists = await self._call(self._check_exists, ticker)
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
            forward_pe=info.get("forwardPE"),
            eps=info.get("trailingEps"),
            week52_high=info.get("fiftyTwoWeekHigh"),
            week52_low=info.get("fiftyTwoWeekLow"),
            volume=info.get("regularMarketVolume") or info.get("volume"),
            dividend_yield=info.get("dividendYield"),
        )

    def _fetch_candles(self, ticker: str, range_key: str) -> list[Candle]:
        import yfinance as yf

        period, interval = RANGE_TO_FETCH[range_key]
        df = yf.Ticker(ticker).history(
            period=period, interval=interval, auto_adjust=True
        )
        if df.empty:
            raise StockNotFound(ticker)
        intraday = interval != "1d"
        return [
            Candle(
                time=(int(idx.timestamp()) if intraday else idx.strftime("%Y-%m-%d")),
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
        except Exception:  # yfinance exception types are unstable; treat any as nonexistent and log
            logger.warning("ticker_exists check failed for %s", ticker, exc_info=True)
            return False

    async def search(self, q: str) -> list[SearchHit]:
        cached = self._search_cache.get(q)
        if cached is not None:
            return cached
        hits = await self._call(self._fetch_search, q)
        self._search_cache.set(q, hits)
        return hits

    def _fetch_search(self, q: str) -> list[SearchHit]:
        import yfinance as yf

        try:
            quotes = yf.Search(q, max_results=20).quotes
        except Exception:
            logger.warning("search failed for %s", q, exc_info=True)
            return []
        out: list[SearchHit] = []
        seen: set[str] = set()
        for row in quotes or []:
            symbol = row.get("symbol")
            if not symbol:
                continue
            symbol = symbol.upper()
            # This product only tracks US stocks: symbols with a "." are listed on foreign exchanges
            # (AAPL.MX / AAPL.TO ...), always excluded; US share classes use "-" on Yahoo (BRK-B) and are unaffected.
            if "." in symbol or symbol in seen:
                continue
            if row.get("quoteType") not in (None, "EQUITY", "ETF"):
                continue
            seen.add(symbol)
            out.append(SearchHit(
                ticker=symbol,
                name=row.get("shortname") or row.get("longname") or symbol,
                exchange=row.get("exchange"),
            ))
        return out[:10]

    async def get_financials(
        self, ticker: str, period: Literal["quarterly", "annual"]
    ) -> list[FinancialReport]:
        key = f"{ticker}:{period}"
        cached = self._financials_cache.get(key)
        if cached is not None:
            return cached
        reports = await self._call(self._fetch_financials, ticker, period)
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

    async def get_daily_history(
        self, tickers: list[str], start: date, end: date
    ) -> dict[str, list[Candle]]:
        """Fetch daily candles for multiple tickers in one HTTP call (used by PriceStore for incremental
        backfill); does not use the cache -- the caller (PriceStore) treats the DB as the source of truth."""
        return await self._call(self._fetch_daily_history, tickers, start, end)

    def _fetch_daily_history(
        self, tickers: list[str], start: date, end: date
    ) -> dict[str, list[Candle]]:
        import yfinance as yf

        out: dict[str, list[Candle]] = {t: [] for t in tickers}
        df = yf.download(
            tickers=" ".join(tickers),
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),  # yf's end is exclusive
            interval="1d",
            auto_adjust=True,
            group_by="ticker",
            progress=False,
            threads=False,
        )
        if df is None or df.empty:
            return out
        for t in tickers:
            try:
                sub = df[t] if df.columns.nlevels > 1 else df
            except KeyError:
                continue
            sub = sub.dropna(subset=["Close"])
            out[t] = [
                Candle(
                    time=idx.strftime("%Y-%m-%d"),
                    open=round(float(row.Open), 4),
                    high=round(float(row.High), 4),
                    low=round(float(row.Low), 4),
                    close=round(float(row.Close), 4),
                    volume=int(row.Volume) if row.Volume == row.Volume else 0,  # NaN volume -> 0
                )
                for idx, row in zip(sub.index, sub.itertuples())
            ]
        return out

    async def get_analyst(self, ticker: str) -> AnalystData:
        cached = self._analyst_cache.get(ticker)
        if cached is not None:
            return cached
        data = await self._call(self._fetch_analyst, ticker)
        self._analyst_cache.set(ticker, data)
        return data

    def _fetch_analyst(self, ticker: str) -> AnalystData:
        import yfinance as yf

        try:
            t = yf.Ticker(ticker)
            info = t.info or {}
            recs: dict[str, int] = {}
            df = t.recommendations_summary
            if df is not None and not df.empty and "period" in df.columns:
                current = df[df["period"] == "0m"]
                if not current.empty:
                    row = current.iloc[0]
                    recs = {
                        k: int(row[k])
                        for k in ("strongBuy", "buy", "hold", "sell", "strongSell")
                        if k in current.columns and row[k] == row[k]
                    }
            return AnalystData(
                target_low=info.get("targetLowPrice"),
                target_mean=info.get("targetMeanPrice"),
                target_high=info.get("targetHighPrice"),
                analyst_count=info.get("numberOfAnalystOpinions"),
                recommendations=recs,
            )
        except Exception:
            logger.warning("analyst fetch failed for %s", ticker, exc_info=True)
            return _EMPTY_ANALYST

    async def get_earnings(self, ticker: str) -> EarningsDates:
        cached = self._earnings_cache.get(ticker)
        if cached is not None:
            return cached
        data = await self._call(self._fetch_earnings, ticker)
        self._earnings_cache.set(ticker, data)
        return data

    def _fetch_earnings(self, ticker: str) -> EarningsDates:
        import yfinance as yf

        try:
            df = yf.Ticker(ticker).get_earnings_dates(limit=24)  # ~5y of quarters + upcoming
        except Exception:
            logger.warning("earnings dates fetch failed for %s", ticker, exc_info=True)
            return _EMPTY_EARNINGS
        if df is None or df.empty:
            return _EMPTY_EARNINGS
        today = datetime.now(timezone.utc).date()
        return split_earnings_dates((ts.date() for ts in df.index), today)


_RANGE_TO_DAYS = {"1m": 22, "3m": 65, "6m": 130, "ytd": 110, "1y": 260, "3y": 780, "5y": 1300}
_FAKE_END_DATE = date(2026, 6, 10)
_FAKE_END_EPOCH = 1_780_000_000  # arbitrary deterministic epoch for fake intraday
_FAKE_ETF_TICKERS = frozenset({"VOO", "QQQ", "VT", "SPY"})


class FakeMarketClient:
    """Deterministic fake data, used in tests and USE_FAKE_ADAPTERS=true mode."""

    KNOWN = {
        "AAPL": "Apple Inc.",
        "NVDA": "NVIDIA Corporation",
        "TSLA": "Tesla, Inc.",
        "VOO": "Vanguard S&P 500 ETF",
        "QQQ": "Invesco QQQ Trust",
        "VT": "Vanguard Total World Stock ETF",
        "SPY": "SPDR S&P 500 ETF Trust",
    }

    async def ticker_exists(self, ticker: str) -> bool:
        return ticker in self.KNOWN

    async def get_summary(self, ticker: str) -> StockSummary:
        if ticker not in self.KNOWN:
            raise StockNotFound(ticker)
        base = float(100 + sum(ord(c) for c in ticker) % 150)
        return StockSummary(
            ticker=ticker, name=self.KNOWN[ticker], price=base,
            change=1.23, change_percent=round(1.23 / base * 100, 4),
            market_cap=base * 1e10, pe_ratio=27.5, forward_pe=round(27.5 * 0.85, 4),
            eps=round(base / 27.5, 2),
            week52_high=base * 1.3, week52_low=base * 0.7,
            volume=42_000_000, dividend_yield=0.5,
        )

    async def get_candles(self, ticker: str, range_key: str) -> list[Candle]:
        if ticker not in self.KNOWN:
            raise StockNotFound(ticker)
        if range_key not in RANGE_TO_FETCH:
            raise ValueError(f"unknown range: {range_key}")
        base = float(100 + sum(ord(c) for c in ticker) % 150)
        if range_key == "1d":
            n = 78  # 6.5h trading day / 5m
            step = 300
        elif range_key == "5d":
            n = 65  # 5 trading days, 30m bars
            step = 1800
        else:
            return self._fake_daily(ticker, range_key, base)
        candles = []
        for i in range(n):
            close = round(base + 5 * math.sin(i / 8), 2)
            candles.append(Candle(
                time=_FAKE_END_EPOCH - (n - 1 - i) * step,
                open=round(close - 0.2, 2), high=round(close + 0.3, 2),
                low=round(close - 0.4, 2), close=close, volume=10_000 + i,
            ))
        return candles

    def _fake_daily(self, ticker: str, range_key: str, base: float) -> list[Candle]:
        n = _RANGE_TO_DAYS[range_key]
        days: list[date] = []
        d = _FAKE_END_DATE
        while len(days) < n:
            if d.weekday() < 5:
                days.append(d)
            d -= timedelta(days=1)
        days.reverse()
        candles = []
        for i, day in enumerate(days):
            close = round(base + 10 * math.sin(i / 10), 2)
            candles.append(Candle(
                time=day.strftime("%Y-%m-%d"),
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

    async def get_daily_history(
        self, tickers: list[str], start: date, end: date
    ) -> dict[str, list[Candle]]:
        out: dict[str, list[Candle]] = {}
        for ticker in tickers:
            if ticker not in self.KNOWN:
                out[ticker] = []
                continue
            base = float(100 + sum(ord(c) for c in ticker) % 150)
            candles: list[Candle] = []
            d = start
            while d <= end:
                if d.weekday() < 5:
                    # Use toordinal as the phase: a given day's price is independent of the fetch window -> incremental backfill stays comparable
                    close = round(base + 10 * math.sin(d.toordinal() / 10), 2)
                    candles.append(Candle(
                        time=d.isoformat(),
                        open=round(close - 0.5, 2), high=round(close + 1.0, 2),
                        low=round(close - 1.0, 2), close=close,
                        volume=1_000_000 + d.toordinal() % 1000,
                    ))
                d += timedelta(days=1)
            out[ticker] = candles
        return out

    async def get_analyst(self, ticker: str) -> AnalystData:
        if ticker not in self.KNOWN:
            return _EMPTY_ANALYST
        base = float(100 + sum(ord(c) for c in ticker) % 150)
        return AnalystData(
            target_low=round(base * 0.85, 2),
            target_mean=round(base * 1.1, 2),
            target_high=round(base * 1.35, 2),
            analyst_count=20 + sum(ord(c) for c in ticker) % 20,
            recommendations={
                "strongBuy": 8, "buy": 10, "hold": 5, "sell": 2, "strongSell": 1,
            },
        )

    async def get_earnings(self, ticker: str) -> EarningsDates:
        # ETFs have no earnings; unknown tickers degrade to empty (decorative data).
        if ticker not in self.KNOWN or ticker in _FAKE_ETF_TICKERS:
            return _EMPTY_EARNINGS
        today = date.today()
        return EarningsDates(
            past=[today - timedelta(days=n) for n in (303, 212, 121, 30)],
            next_date=today + timedelta(days=30),
        )
