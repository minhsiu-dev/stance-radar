"""頻道記分板:每個 buy/sell call 之後 7/30/90 天的前瞻報酬,並對比 SPY。

報酬定義:
- entry:影片發布日(含)之後第一個交易日收盤價
- exit:entry 日 + N 個「日曆日」(含)之後第一個交易日收盤價
- return = (exit / entry - 1) * 100;alpha = return - 同窗口 SPY return
- 資料不足(影片太新 / 已下市)→ None,聚合時排除

neutral 立場無方向性,不參與記分。
"""
import asyncio
import logging
from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import date, timedelta

from app.market.client import MarketClient

logger = logging.getLogger(__name__)

HORIZONS = (7, 30, 90)
BENCHMARK = "SPY"
CANDLE_RANGE = "5y"  # 日 K,夠涵蓋本工具的歷史 call
_FETCH_CONCURRENCY = 4


@dataclass(frozen=True)
class PriceSeries:
    """已排序的 (date, close) 序列,提供「該日(含)之後第一個收盤價」查詢。"""

    dates: tuple[date, ...]
    closes: tuple[float, ...]

    def close_on_or_after(self, target: date) -> tuple[date, float] | None:
        i = bisect_left(self.dates, target)
        if i >= len(self.dates):
            return None
        return self.dates[i], self.closes[i]


@dataclass
class CallScore:
    video_id: str
    video_title: str
    ticker: str
    stance: str  # buy | sell
    confidence: str | None
    summary: str
    published_at: str  # ISO datetime
    entry_date: str | None = None
    entry_price: float | None = None
    # horizon(days)→ 報酬 %;尚未到期或無資料 → None
    returns: dict[int, float | None] = field(default_factory=dict)
    alpha: dict[int, float | None] = field(default_factory=dict)
    has_data: bool = True


def _to_series(candles) -> PriceSeries | None:
    dates: list[date] = []
    closes: list[float] = []
    for c in candles:
        if not isinstance(c.time, str):  # 只認日 K
            continue
        dates.append(date.fromisoformat(c.time))
        closes.append(c.close)
    if not dates:
        return None
    return PriceSeries(dates=tuple(dates), closes=tuple(closes))


async def fetch_price_series(
    market: MarketClient, tickers: set[str]
) -> dict[str, PriceSeries | None]:
    semaphore = asyncio.Semaphore(_FETCH_CONCURRENCY)

    async def fetch(ticker: str) -> tuple[str, PriceSeries | None]:
        async with semaphore:
            try:
                candles = await market.get_candles(ticker, CANDLE_RANGE)
            except Exception:
                logger.warning("scorecard: no candles for %s", ticker)
                return ticker, None
        return ticker, _to_series(candles)

    results = await asyncio.gather(*(fetch(t) for t in sorted(tickers)))
    return dict(results)


def _window_return(series: PriceSeries, published: date, horizon: int) -> tuple:
    """回傳 (entry_date, entry_price, return_pct | None)。"""
    entry = series.close_on_or_after(published)
    if entry is None:
        return None, None, None
    entry_date, entry_price = entry
    exit_ = series.close_on_or_after(entry_date + timedelta(days=horizon))
    if exit_ is None or entry_price == 0:
        return entry_date, entry_price, None
    return entry_date, entry_price, round((exit_[1] / entry_price - 1) * 100, 2)


def score_call(
    call: CallScore,
    series: PriceSeries | None,
    benchmark: PriceSeries | None,
    published: date,
) -> CallScore:
    if series is None:
        call.has_data = False
        call.returns = {h: None for h in HORIZONS}
        call.alpha = {h: None for h in HORIZONS}
        return call
    for h in HORIZONS:
        entry_date, entry_price, ret = _window_return(series, published, h)
        if call.entry_date is None and entry_date is not None:
            call.entry_date = entry_date.isoformat()
            call.entry_price = entry_price
        call.returns[h] = ret
        bench_ret = None
        if benchmark is not None:
            _, _, bench_ret = _window_return(benchmark, published, h)
        call.alpha[h] = (
            round(ret - bench_ret, 2)
            if ret is not None and bench_ret is not None
            else None
        )
    return call


def aggregate(calls: list[CallScore]) -> dict:
    """per stance × horizon:已實現樣本數、平均報酬、平均 alpha、勝率。

    勝率:buy call 漲了就算對;sell call 跌了就算對(看 raw return)。
    """
    out: dict = {}
    for stance in ("buy", "sell"):
        stance_calls = [c for c in calls if c.stance == stance]
        per_horizon = {}
        for h in HORIZONS:
            realized = [c for c in stance_calls if c.returns.get(h) is not None]
            rets = [c.returns[h] for c in realized]
            alphas = [c.alpha[h] for c in realized if c.alpha.get(h) is not None]
            wins = [r for r in rets if (r > 0 if stance == "buy" else r < 0)]
            per_horizon[h] = {
                "count": len(realized),
                "avg_return": round(sum(rets) / len(rets), 2) if rets else None,
                "avg_alpha": (
                    round(sum(alphas) / len(alphas), 2) if alphas else None
                ),
                "win_rate": (
                    round(len(wins) / len(realized) * 100, 1) if realized else None
                ),
            }
        out[stance] = {"total": len(stance_calls), "horizons": per_horizon}
    return out


async def build_scorecard(
    market: MarketClient,
    raw_calls: list[dict],
) -> dict:
    """raw_calls:[{video_id, video_title, ticker, stance, confidence, summary,
    published_at(datetime)}…],已含該頻道全部非 neutral 立場。"""
    tickers = {c["ticker"] for c in raw_calls}
    series_map = await fetch_price_series(market, tickers | {BENCHMARK})
    benchmark = series_map.get(BENCHMARK)

    calls: list[CallScore] = []
    for raw in raw_calls:
        published_dt = raw["published_at"]
        call = CallScore(
            video_id=raw["video_id"],
            video_title=raw["video_title"],
            ticker=raw["ticker"],
            stance=raw["stance"],
            confidence=raw.get("confidence"),
            summary=raw["summary"],
            published_at=published_dt.isoformat(),
        )
        calls.append(score_call(
            call, series_map.get(raw["ticker"]), benchmark, published_dt.date()
        ))

    calls.sort(key=lambda c: c.published_at, reverse=True)
    return {
        "horizons": list(HORIZONS),
        "benchmark": BENCHMARK,
        "aggregates": aggregate(calls),
        "calls": [
            {
                "video_id": c.video_id,
                "video_title": c.video_title,
                "ticker": c.ticker,
                "stance": c.stance,
                "confidence": c.confidence,
                "summary": c.summary,
                "published_at": c.published_at,
                "entry_date": c.entry_date,
                "entry_price": c.entry_price,
                "returns": {str(h): c.returns.get(h) for h in HORIZONS},
                "alpha": {str(h): c.alpha.get(h) for h in HORIZONS},
                "has_data": c.has_data,
            }
            for c in calls
        ],
    }
