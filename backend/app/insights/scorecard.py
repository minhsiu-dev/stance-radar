"""Channel scorecard: forward returns 7/30/90 days after each buy/sell call, benchmarked against SPY.

Return definitions:
- entry: closing price on the first trading day on or after the video's publish date
- exit: closing price on the first trading day on or after entry date + N "calendar days"
- return = (exit / entry - 1) * 100; alpha = return - SPY return over the same window
- insufficient data (video too new / delisted) -> None, excluded from aggregation

A neutral stance has no direction and is not scored.
"""
import logging
import statistics
from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from app.market.store import PriceStore

logger = logging.getLogger(__name__)

HORIZONS = (30, 90)
BENCHMARK = "SPY"  # aggregate/leaderboard path
SCORECARD_BENCHMARK = "VOO"  # per-call paginated scorecard path
_HISTORY_DAYS = 1827  # 5 years, covers this tool's historical calls


@dataclass(frozen=True)
class PriceSeries:
    """A sorted (date, close) series providing "first closing price on or after a given date" lookups."""

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
    # horizon (days) -> return %; not yet matured or no data -> None
    returns: dict[int, float | None] = field(default_factory=dict)
    alpha: dict[int, float | None] = field(default_factory=dict)
    now_return: float | None = None
    now_alpha: float | None = None
    has_data: bool = True


def _to_series(candles) -> PriceSeries | None:
    dates: list[date] = []
    closes: list[float] = []
    for c in candles:
        if not isinstance(c.time, str):  # only accept daily candles
            continue
        dates.append(date.fromisoformat(c.time))
        closes.append(c.close)
    if not dates:
        return None
    return PriceSeries(dates=tuple(dates), closes=tuple(closes))


async def fetch_price_series(
    store: PriceStore, tickers: set[str]
) -> dict[str, PriceSeries | None]:
    start = datetime.now(timezone.utc).date() - timedelta(days=_HISTORY_DAYS)
    data = await store.get_daily(sorted(tickers), start)
    return {t: _to_series(data.get(t, [])) for t in tickers}


def _window_return(series: PriceSeries, published: date, horizon: int) -> tuple:
    """Return (entry_date, entry_price, return_pct | None)."""
    entry = series.close_on_or_after(published)
    if entry is None:
        return None, None, None
    entry_date, entry_price = entry
    exit_ = series.close_on_or_after(entry_date + timedelta(days=horizon))
    if exit_ is None or entry_price == 0:
        return entry_date, entry_price, None
    return entry_date, entry_price, round((exit_[1] / entry_price - 1) * 100, 2)


def _now_return(series: PriceSeries, published: date) -> tuple:
    """Return (entry_date, entry_price, return_pct | None) from entry to the latest close."""
    entry = series.close_on_or_after(published)
    if entry is None:
        return None, None, None
    entry_date, entry_price = entry
    if entry_price == 0:
        return entry_date, entry_price, None
    latest_close = series.closes[-1]
    return entry_date, entry_price, round((latest_close / entry_price - 1) * 100, 2)


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
        call.now_return = None
        call.now_alpha = None
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
    _, _, now_ret = _now_return(series, published)
    call.now_return = now_ret
    bench_now = None
    if benchmark is not None:
        _, _, bench_now = _now_return(benchmark, published)
    call.now_alpha = (
        round(now_ret - bench_now, 2)
        if now_ret is not None and bench_now is not None
        else None
    )
    return call


def aggregate(calls: list[CallScore]) -> dict:
    """per stance x horizon: realized sample count, average return, average alpha, win rate.

    Win rate: a buy call counts as correct if the stock rose; a sell call if it fell (using raw return).
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


_SUMMARY_HORIZONS = ("now", "30", "90")


def _adjusted_alpha(call: CallScore, horizon: str) -> float | None:
    """Alpha vs VOO, sign-flipped for sells so a short 'wins' when the stock
    underperforms the benchmark."""
    alpha = call.now_alpha if horizon == "now" else call.alpha.get(int(horizon))
    if alpha is None:
        return None
    return alpha if call.stance == "buy" else -alpha


def _summary_cell(calls: list[CallScore], horizon: str) -> dict:
    vals = [a for a in (_adjusted_alpha(c, horizon) for c in calls) if a is not None]
    n = len(vals)
    if n == 0:
        return {"win_rate": None, "avg": None, "median": None, "n": 0}
    wins = sum(1 for v in vals if v > 0)
    return {
        "win_rate": round(wins / n * 100, 1),
        "avg": round(sum(vals) / n, 2),
        "median": round(statistics.median(vals), 2),
        "n": n,
    }


def summarize_channel_calls(calls: list[CallScore]) -> dict:
    """all/buy/sell x now/30/90 of stance-adjusted alpha vs VOO.

    `calls` are already-scored directional (buy/sell) CallScores. Win = adjusted
    alpha > 0 (strict); avg/median over realized calls; n = realized count.
    """
    groups = {
        "all": calls,
        "buy": [c for c in calls if c.stance == "buy"],
        "sell": [c for c in calls if c.stance == "sell"],
    }
    return {
        "summary": {
            g: {h: _summary_cell(gc, h) for h in _SUMMARY_HORIZONS}
            for g, gc in groups.items()
        },
        "counts": {g: len(gc) for g, gc in groups.items()},
    }


def _serialize_call(c: CallScore) -> dict:
    return {
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
        "now_return": c.now_return,
        "now_alpha": c.now_alpha,
        "has_data": c.has_data,
    }


def _score_calls(
    raw_calls: list[dict],
    series_map: dict[str, PriceSeries | None],
    benchmark_series: PriceSeries | None,
) -> list[CallScore]:
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
            call, series_map.get(raw["ticker"]), benchmark_series,
            published_dt.date(),
        ))
    calls.sort(key=lambda c: c.published_at, reverse=True)
    return calls


async def build_scorecard(
    store: PriceStore,
    raw_calls: list[dict],
) -> dict:
    """raw_calls: [{video_id, video_title, ticker, stance, confidence, summary,
    published_at(datetime)}...], already containing all of the channel's non-neutral stances."""
    tickers = {c["ticker"] for c in raw_calls}
    series_map = await fetch_price_series(store, tickers | {BENCHMARK})
    calls = _score_calls(raw_calls, series_map, series_map.get(BENCHMARK))
    return {
        "horizons": list(HORIZONS),
        "benchmark": BENCHMARK,
        "aggregates": aggregate(calls),
        "calls": [_serialize_call(c) for c in calls],
    }


async def build_scorecard_page(
    store: PriceStore,
    raw_calls: list[dict],
    total: int,
    page: int,
    page_size: int,
    benchmark: str = SCORECARD_BENCHMARK,
) -> dict:
    """Score ONLY this page's calls (no cross-page aggregates).

    Prices just this page's tickers + benchmark, so each request stays bounded
    no matter how many calls the channel has. `raw_calls` is the current page,
    newest first.
    """
    tickers = {c["ticker"] for c in raw_calls}
    series_map = await fetch_price_series(store, tickers | {benchmark})
    calls = _score_calls(raw_calls, series_map, series_map.get(benchmark))
    return {
        "horizons": list(HORIZONS),
        "benchmark": benchmark,
        "total": total,
        "page": page,
        "page_size": page_size,
        "calls": [_serialize_call(c) for c in calls],
    }


async def build_channel_performance(
    store: PriceStore,
    raw_calls: list[dict],
    window_days: int = 180,
    benchmark: str = SCORECARD_BENCHMARK,
) -> dict:
    """Score every directional call in the window and summarize all/buy/sell x
    now/30/90 vs VOO. `raw_calls` is every non-neutral stance in the window.

    Caller must pre-filter `raw_calls` to the window; `window_days` is only echoed
    into the response, not applied here.
    Benchmark defaults to VOO (`SCORECARD_BENCHMARK`), unlike `build_scorecard` which uses SPY.
    """
    tickers = {c["ticker"] for c in raw_calls}
    series_map = await fetch_price_series(store, tickers | {benchmark})
    calls = _score_calls(raw_calls, series_map, series_map.get(benchmark))
    return {
        "benchmark": benchmark,
        "window_days": window_days,
        "horizons": list(_SUMMARY_HORIZONS),  # ["now", "30", "90"] — same keys as `summary`
        **summarize_channel_calls(calls),
    }
