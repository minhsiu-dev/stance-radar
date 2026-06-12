import asyncio
import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Protocol

from app.market.cache import TTLCache

logger = logging.getLogger(__name__)

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
class NewsItem:
    ticker: str
    title: str
    url: str
    publisher: str | None
    published_at: str  # ISO 8601


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
    async def get_news(self, ticker: str) -> list[NewsItem]: ...


class YFinanceMarketClient:
    def __init__(self) -> None:
        self._summary_cache = TTLCache(ttl_seconds=900)     # 15 分鐘
        self._candles_cache = TTLCache(ttl_seconds=3600)    # 1 小時
        self._exists_cache = TTLCache(ttl_seconds=86400)    # 1 天
        self._search_cache = TTLCache(ttl_seconds=300)      # 5 分鐘
        self._financials_cache = TTLCache(ttl_seconds=86400) # 24 小時,財報一季才變一次
        self._news_cache = TTLCache(ttl_seconds=900)        # 15 分鐘

    async def get_summary(self, ticker: str) -> StockSummary:
        cached = self._summary_cache.get(ticker)
        if cached is not None:
            return cached
        summary = await asyncio.to_thread(self._fetch_summary, ticker)
        self._summary_cache.set(ticker, summary)
        return summary

    async def get_candles(self, ticker: str, range_key: str) -> list[Candle]:
        if range_key not in RANGE_TO_FETCH:
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
            # 本產品只追美股:帶「.」的是外國交易所掛牌(AAPL.MX / AAPL.TO…),
            # 一律排除;美股股別在 Yahoo 用「-」(BRK-B)不受影響。
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

    async def get_daily_history(
        self, tickers: list[str], start: date, end: date
    ) -> dict[str, list[Candle]]:
        """多檔日 K 一次 HTTP 抓回(PriceStore 增量補抓用),不走 cache——
        呼叫端(PriceStore)自己以 DB 為準。"""
        return await asyncio.to_thread(self._fetch_daily_history, tickers, start, end)

    def _fetch_daily_history(
        self, tickers: list[str], start: date, end: date
    ) -> dict[str, list[Candle]]:
        import yfinance as yf

        out: dict[str, list[Candle]] = {t: [] for t in tickers}
        df = yf.download(
            tickers=" ".join(tickers),
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),  # yf 的 end 是開區間
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
                    volume=int(row.Volume) if row.Volume == row.Volume else 0,  # NaN 量能 → 0
                )
                for idx, row in zip(sub.index, sub.itertuples())
            ]
        return out

    async def get_news(self, ticker: str) -> list[NewsItem]:
        cached = self._news_cache.get(ticker)
        if cached is not None:
            return cached
        items = await asyncio.to_thread(self._fetch_news, ticker)
        self._news_cache.set(ticker, items)
        return items

    def _fetch_news(self, ticker: str) -> list[NewsItem]:
        import yfinance as yf

        try:
            raw = yf.Ticker(ticker).news or []
        except Exception:
            logger.warning("news fetch failed for %s", ticker, exc_info=True)
            return []
        out: list[NewsItem] = []
        for item in raw:
            # yfinance ≥0.2.50 把欄位包在 content 裡;舊版攤平在最外層
            content = item.get("content") or item
            title = content.get("title")
            url = (
                (content.get("canonicalUrl") or {}).get("url")
                or content.get("link")
            )
            publisher = (
                (content.get("provider") or {}).get("displayName")
                or content.get("publisher")
            )
            published = content.get("pubDate")
            if published is None and content.get("providerPublishTime"):
                published = datetime.fromtimestamp(
                    content["providerPublishTime"], timezone.utc
                ).isoformat()
            if not title or not url or not published:
                continue
            out.append(NewsItem(
                ticker=ticker.upper(), title=title, url=url,
                publisher=publisher, published_at=str(published),
            ))
        return out[:10]


_RANGE_TO_DAYS = {"1m": 22, "3m": 65, "6m": 130, "ytd": 110, "1y": 260, "3y": 780, "5y": 1300}
_FAKE_END_DATE = date(2026, 6, 10)
_FAKE_END_EPOCH = 1_780_000_000  # arbitrary deterministic epoch for fake intraday


class FakeMarketClient:
    """確定性假資料,測試與 USE_FAKE_ADAPTERS=true 模式使用。"""

    KNOWN = {
        "AAPL": "Apple Inc.",
        "NVDA": "NVIDIA Corporation",
        "TSLA": "Tesla, Inc.",
        "VOO": "Vanguard S&P 500 ETF",
        "QQQ": "Invesco QQQ Trust",
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
                    # 以 toordinal 為相位:同一天的價格與抓取視窗無關 → 增量補抓可比對
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

    async def get_news(self, ticker: str) -> list[NewsItem]:
        if ticker not in self.KNOWN:
            return []
        offset = sum(ord(c) for c in ticker) % 12
        return [
            NewsItem(
                ticker=ticker,
                title=f"{self.KNOWN[ticker]} fake headline {i}",
                url=f"https://news.example.com/{ticker.lower()}/{i}",
                publisher="Fake Wire",
                published_at=f"2026-06-{10 - i:02d}T{offset:02d}:00:00+00:00",
            )
            for i in (1, 2)
        ]
