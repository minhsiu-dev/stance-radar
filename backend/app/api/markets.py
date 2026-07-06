import asyncio
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from app.api.deps import get_market, get_price_store
from app.envelope import ok
from app.market.client import MarketClient
from app.market.performance import (
    PERFORMANCE_RANGES, change_percent, slice_for_range,
)
from app.market.store import PriceStore

router = APIRouter(prefix="/api/markets")

BENCHMARKS = ("VOO", "QQQ", "VT")
_MAX_HISTORY_DAYS = 366  # longest performance range is 1y


async def _one_day_changes(
    market: MarketClient, tickers: tuple[str, ...]
) -> dict[str, float | None]:
    """1D % per ticker from the real-time quote; missing quote -> None."""
    async def summary_or_none(ticker: str):
        try:
            return await market.get_summary(ticker)
        except Exception:
            return None

    summaries = dict(zip(
        tickers, await asyncio.gather(*(summary_or_none(t) for t in tickers))
    ))
    return {
        t: (summaries[t].change_percent if summaries.get(t) else None)
        for t in tickers
    }


@router.get("/benchmarks")
async def benchmarks(
    market: MarketClient = Depends(get_market),
    store: PriceStore = Depends(get_price_store),
):
    today = datetime.now(timezone.utc).date()
    start = min(today - timedelta(days=_MAX_HISTORY_DAYS), date(today.year, 1, 1))
    bars = await store.get_daily(list(BENCHMARKS), start)
    day1 = await _one_day_changes(market, BENCHMARKS)

    def changes_for(values) -> dict:
        return {
            r: change_percent(slice_for_range(values, r, today))
            for r in PERFORMANCE_RANGES
            if r != "1d"
        }

    items = []
    for t in BENCHMARKS:
        values = [(date.fromisoformat(c.time), c.close) for c in bars[t]]
        items.append({
            "ticker": t,
            "price": values[-1][1] if values else None,
            "changes": {"1d": day1[t], **changes_for(values)},
        })
    return ok({"ranges": list(PERFORMANCE_RANGES), "items": items})
