"""Daily-candle persistence layer: DB is the source of truth; only gaps hit yfinance (incremental, batched).

Coverage rules (price_coverage has one row per ticker, describing the contiguous covered range):
- no record, or the requested start is earlier than start_date -> refetch the whole range (avoids splice logic)
- end_date < today and >=1 hour since last sync -> trailing backfill, reaching back an extra 7 days of overlap
- closing-price deviation >0.5% within the overlap -> series was readjusted (split/dividend) -> wipe and refetch the whole ticker
"""
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Mapping, Protocol

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.market.client import Candle, MarketClient
from app.models import PriceBar, PriceCoverage

logger = logging.getLogger(__name__)

_TRAILING_SYNC_INTERVAL = timedelta(hours=1)
_OVERLAP_DAYS = 7
_ADJUST_TOLERANCE = 0.005


class _CoverageLike(Protocol):
    start_date: date
    end_date: date
    last_synced_at: datetime


@dataclass(frozen=True)
class FetchPlan:
    full: dict[str, date] = field(default_factory=dict)
    trailing: dict[str, date] = field(default_factory=dict)


def plan_fetches(
    coverage: Mapping[str, _CoverageLike],
    tickers: Iterable[str],
    start: date,
    today: date,
    now: datetime,
) -> FetchPlan:
    full: dict[str, date] = {}
    trailing: dict[str, date] = {}
    for ticker in tickers:
        cov = coverage.get(ticker)
        if cov is None or cov.start_date > start:
            full[ticker] = start
        elif (
            cov.end_date < today
            and now - cov.last_synced_at >= _TRAILING_SYNC_INTERVAL
        ):
            trailing[ticker] = cov.end_date - timedelta(days=_OVERLAP_DAYS)
    return FetchPlan(full=full, trailing=trailing)


class PriceStore:
    def __init__(self, sessionmaker, market: MarketClient) -> None:
        self._sessionmaker = sessionmaker
        self._market = market
        self._lock = asyncio.Lock()  # serialize syncs to avoid concurrent upserts colliding on the PK

    async def ensure_daily(self, tickers: list[str], start: date) -> None:
        """Plan -> fetch -> persist daily candles for `tickers` back to `start`,
        WITHOUT loading the series into Python. Network only for cold/stale tickers
        (a no-op when warm); the DB stays the source of truth. This is the lean half
        of get_daily, used when callers only need price_bars populated (e.g. the
        per-ticker SQL aggregation), not the candles themselves."""
        now = datetime.now(timezone.utc)
        today = now.date()
        async with self._lock:
            async with self._sessionmaker() as session:
                covs = {
                    c.ticker: c
                    for c in (await session.execute(
                        select(PriceCoverage).where(
                            PriceCoverage.ticker.in_(tickers)
                        )
                    )).scalars()
                }
                plan = plan_fetches(covs, tickers, start, today, now)
                if plan.full:
                    data = await self._market.get_daily_history(
                        sorted(plan.full), min(plan.full.values()), today
                    )
                    for t, fetch_start in plan.full.items():
                        candles = [c for c in data.get(t, []) if isinstance(c.time, str)]
                        await self._upsert(session, t, candles)
                        # Empty result (invalid ticker or transient upstream failure): set end_date to the day before the start,
                        # so a later trailing sync (at most hourly) retries from scratch -> transient failures self-heal
                        end = today if candles else fetch_start - timedelta(days=1)
                        cov_start = fetch_start
                        if candles:
                            first_bar = date.fromisoformat(candles[0].time)
                            cov_start = min(cov_start, first_bar)
                        await self._set_coverage(session, covs, t, cov_start, end, now)
                if plan.trailing:
                    data = await self._market.get_daily_history(
                        sorted(plan.trailing), min(plan.trailing.values()), today
                    )
                    rescaled: list[str] = []
                    for t in plan.trailing:
                        if await self._has_rescaled(session, t, data.get(t, [])):
                            rescaled.append(t)
                        else:
                            await self._upsert(session, t, data.get(t, []))
                            covs[t].end_date = today
                            covs[t].last_synced_at = now
                    if rescaled:
                        logger.warning("price store: rescale detected, refetch %s", rescaled)
                        redo = await self._market.get_daily_history(
                            sorted(rescaled),
                            min(covs[t].start_date for t in rescaled),
                            today,
                        )
                        for t in rescaled:
                            await session.execute(
                                delete(PriceBar).where(PriceBar.ticker == t)
                            )
                            await self._upsert(session, t, redo.get(t, []))
                            covs[t].end_date = today
                            covs[t].last_synced_at = now
                await session.commit()

    async def get_daily(
        self, tickers: list[str], start: date
    ) -> dict[str, list[Candle]]:
        await self.ensure_daily(tickers, start)
        async with self._sessionmaker() as session:
            rows = (await session.execute(
                select(PriceBar)
                .where(PriceBar.ticker.in_(tickers), PriceBar.date >= start)
                .order_by(PriceBar.ticker, PriceBar.date)
            )).scalars().all()
        out: dict[str, list[Candle]] = {t: [] for t in tickers}
        for r in rows:
            out[r.ticker].append(Candle(
                time=r.date.isoformat(), open=r.open, high=r.high,
                low=r.low, close=r.close, volume=r.volume,
            ))
        return out

    async def _upsert(self, session, ticker: str, candles: list[Candle]) -> None:
        rows = [
            {
                "ticker": ticker, "date": date.fromisoformat(c.time),
                "open": c.open, "high": c.high, "low": c.low,
                "close": c.close, "volume": c.volume,
            }
            for c in candles
            if isinstance(c.time, str)
        ]
        if not rows:
            return
        stmt = pg_insert(PriceBar).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["ticker", "date"],
            set_={k: stmt.excluded[k] for k in ("open", "high", "low", "close", "volume")},
        )
        await session.execute(stmt)

    async def _set_coverage(
        self, session, covs: dict, ticker: str,
        start: date, end: date, now: datetime,
    ) -> None:
        cov = covs.get(ticker)
        if cov is None:
            cov = PriceCoverage(
                ticker=ticker, start_date=start, end_date=end, last_synced_at=now
            )
            session.add(cov)
            covs[ticker] = cov
        else:
            cov.start_date = min(cov.start_date, start)
            cov.end_date = end
            cov.last_synced_at = now

    async def _has_rescaled(
        self, session, ticker: str, fetched: list[Candle]
    ) -> bool:
        by_date = {
            date.fromisoformat(c.time): c.close
            for c in fetched
            if isinstance(c.time, str)
        }
        if not by_date:
            return False
        stored = (await session.execute(
            select(PriceBar.date, PriceBar.close).where(
                PriceBar.ticker == ticker, PriceBar.date >= min(by_date)
            )
        )).all()
        for bar_date, bar_close in stored:
            new = by_date.get(bar_date)
            if new is None or bar_close == 0:
                continue
            if abs(new - bar_close) / abs(bar_close) > _ADJUST_TOLERANCE:
                return True
        return False
