import asyncio
import hmac
import logging
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_market, get_price_store, get_session
from app.config import get_settings
from app.envelope import fail, ok
from app.market.client import MarketClient
from app.market.store import PriceStore
from app.models import PortfolioTransaction, TransactionSide, utcnow
from app.portfolio.auth import clear, is_unlocked, issue, require_unlock
from app.portfolio.cash import get_cash, set_cash
from app.portfolio.holdings import Holding, InvalidTransaction, replay
from app.portfolio.performance import (
    PERFORMANCE_RANGES, change_percent, normalize, portfolio_values,
    slice_for_range,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/portfolio")

BENCHMARKS = ("VOO", "QQQ")
_MAX_HISTORY_DAYS = 366  # longest performance range is 1y


class TransactionIn(BaseModel):
    ticker: str = Field(min_length=1, max_length=10)
    side: Literal["buy", "sell"]
    shares: Decimal = Field(gt=0)
    price: Decimal = Field(gt=0)
    executed_on: date
    note: str | None = None


class CashBody(BaseModel):
    amount: float


class UnlockBody(BaseModel):
    password: str


_WRONG_PASSWORD_DELAY = 0.3


@router.post("/unlock")
async def unlock(body: UnlockBody, response: Response):
    settings = get_settings()
    password = settings.portfolio_password
    if not password:
        return ok({"authenticated": True})  # feature disabled
    if not hmac.compare_digest(body.password.encode(), password.encode()):
        await asyncio.sleep(_WRONG_PASSWORD_DELAY)  # mild anti-guess
        return fail("Wrong password", status_code=401)
    issue(response, password, settings.portfolio_lock_idle_minutes)
    return ok({"authenticated": True})


@router.post("/lock")
async def lock(response: Response):
    clear(response)
    return ok({"authenticated": False})


@router.get("/session")
async def session_status(request: Request, response: Response):
    password = get_settings().portfolio_password
    return ok({
        "enabled": bool(password),
        "authenticated": is_unlocked(request, response),
    })


def _tx_dict(t: PortfolioTransaction) -> dict:
    return {
        "id": t.id,
        "ticker": t.ticker,
        "side": t.side.value,
        "shares": float(t.shares),
        "price": float(t.price),
        "executed_on": t.executed_on.isoformat(),
        "note": t.note,
        "created_at": t.created_at.isoformat(),
    }


async def _all_transactions(session: AsyncSession) -> list[PortfolioTransaction]:
    return list((await session.execute(
        select(PortfolioTransaction)
    )).scalars().all())


@router.get("/transactions")
async def list_transactions(
    session: AsyncSession = Depends(get_session),
    _: None = Depends(require_unlock),
):
    txs = (await session.execute(
        select(PortfolioTransaction).order_by(
            PortfolioTransaction.executed_on.desc(),
            PortfolioTransaction.created_at.desc(),
        )
    )).scalars().all()
    return ok([_tx_dict(t) for t in txs])


@router.post("/transactions")
async def add_transaction(
    body: TransactionIn,
    session: AsyncSession = Depends(get_session),
    market: MarketClient = Depends(get_market),
    _: None = Depends(require_unlock),
):
    ticker = body.ticker.upper().strip()
    today = datetime.now(timezone.utc).date()
    if body.executed_on > today:
        return fail("Transaction date cannot be in the future", status_code=422)
    if not await market.ticker_exists(ticker):
        return fail(f"No stock found: {ticker}", status_code=422)
    tx = PortfolioTransaction(
        ticker=ticker, side=TransactionSide(body.side),
        shares=body.shares, price=body.price,
        executed_on=body.executed_on, note=body.note,
        # The column default only takes effect at INSERT; the validation-stage replay sort needs a real value,
        # otherwise comparing against an existing same-day transaction raises TypeError (None < datetime)
        created_at=utcnow(),
    )
    existing = await _all_transactions(session)
    try:
        replay([*existing, tx])
    except InvalidTransaction as exc:
        return fail(str(exc), status_code=422)
    session.add(tx)
    await session.commit()
    return ok(_tx_dict(tx))


@router.delete("/transactions/{tx_id}")
async def delete_transaction(
    tx_id: str,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(require_unlock),
):
    tx = await session.get(PortfolioTransaction, tx_id)
    if tx is None:
        return fail("Transaction not found", status_code=404)
    remaining = [t for t in await _all_transactions(session) if t.id != tx_id]
    try:
        replay(remaining)
    except InvalidTransaction as exc:
        return fail(f"Transaction records inconsistent after deletion: {exc}", status_code=422)
    await session.delete(tx)
    await session.commit()
    return ok({"deleted": True})


@router.get("/cash")
async def get_cash_balance(
    session: AsyncSession = Depends(get_session),
    _: None = Depends(require_unlock),
):
    return ok({"amount": float(await get_cash(session))})


@router.put("/cash")
async def put_cash_balance(
    body: CashBody,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(require_unlock),
):
    if body.amount < 0:
        return fail("cash must be >= 0", status_code=400)
    await set_cash(session, Decimal(str(body.amount)))
    return ok({"amount": body.amount})


async def _held(session: AsyncSession) -> dict[str, Holding]:
    return replay(await _all_transactions(session))


@router.get("/holdings")
async def holdings(
    session: AsyncSession = Depends(get_session),
    market: MarketClient = Depends(get_market),
    _: None = Depends(require_unlock),
):
    held = await _held(session)

    async def summary_or_none(ticker: str):
        try:
            return await market.get_summary(ticker)
        except Exception:
            logger.warning("holdings: summary failed for %s", ticker)
            return None

    summaries = dict(zip(
        held,
        await asyncio.gather(*(summary_or_none(t) for t in held)),
    ))
    rows = []
    total_value = 0.0
    total_cost = 0.0
    for ticker, h in sorted(held.items()):
        s = summaries.get(ticker)
        price = s.price if s else None
        value = round(float(h.shares) * price, 2) if price is not None else None
        cost = round(float(h.cost_basis), 2)
        rows.append({
            "ticker": ticker,
            "shares": float(h.shares),
            "avg_cost": round(float(h.avg_cost), 4),
            "price": price,
            "change_percent": s.change_percent if s else None,
            "market_value": value,
            "unrealized_pl": round(value - cost, 2) if value is not None else None,
            "unrealized_pl_percent": (
                round((value - cost) / cost * 100, 2)
                if value is not None and cost else None
            ),
            "weight": None,  # filled in below (needs total market value)
        })
        total_cost += cost
        if value is not None:
            total_value += value
    cash = float(await get_cash(session))
    denom = total_value + cash
    for row in rows:
        if row["market_value"] is not None and denom:
            row["weight"] = round(row["market_value"] / denom * 100, 2)
    rows.sort(key=lambda r: -(r["market_value"] or 0))
    all_quotes_missing = bool(rows) and all(
        r["market_value"] is None for r in rows
    )
    return ok({
        "holdings": rows,
        "totals": {
            "market_value": None if all_quotes_missing else round(total_value, 2),
            "cost_basis": round(total_cost, 2),
            "unrealized_pl": (
                None if all_quotes_missing else round(total_value - total_cost, 2)
            ),
            "unrealized_pl_percent": (
                round((total_value - total_cost) / total_cost * 100, 2)
                if total_cost and not all_quotes_missing else None
            ),
            "cash": round(cash, 2),
            "total_value": None if all_quotes_missing else round(total_value + cash, 2),
            "cash_weight": (
                round(cash / denom * 100, 2)
                if denom and not all_quotes_missing else None
            ),
        },
    })


async def _one_day_changes(
    market: MarketClient, held: dict[str, Holding], cash: float = 0.0
) -> tuple[float | None, dict[str, float | None], float | None]:
    """Return (portfolio 1d %, {benchmark: 1d %}, portfolio current value)."""
    # Holdings missing a quote are simply skipped -> the numbers are best-effort over the "quoted portion";
    # when all quotes are missing, total_now=0 -> return None

    async def summary_or_none(ticker: str):
        try:
            return await market.get_summary(ticker)
        except Exception:
            return None

    tickers = [*held, *BENCHMARKS]
    summaries = dict(zip(
        tickers, await asyncio.gather(*(summary_or_none(t) for t in tickers))
    ))
    total_now = 0.0
    total_prev = 0.0
    for ticker, h in held.items():
        s = summaries.get(ticker)
        if s is None or s.price is None:
            continue
        total_now += float(h.shares) * s.price
        total_prev += float(h.shares) * (s.price - (s.change or 0.0))
    total_now += cash
    total_prev += cash
    portfolio_1d = (
        round((total_now / total_prev - 1) * 100, 2) if total_prev else None
    )
    bench_1d = {
        b: (summaries[b].change_percent if summaries.get(b) else None)
        for b in BENCHMARKS
    }
    return portfolio_1d, bench_1d, (round(total_now, 2) if total_now else None)


@router.get("/performance/summary")
async def performance_summary(
    session: AsyncSession = Depends(get_session),
    market: MarketClient = Depends(get_market),
    store: PriceStore = Depends(get_price_store),
    authed: bool = Depends(is_unlocked),
):
    held = await _held(session)
    cash = float(await get_cash(session))
    today = datetime.now(timezone.utc).date()
    start = min(
        today - timedelta(days=_MAX_HISTORY_DAYS), date(today.year, 1, 1)
    )
    bars = await store.get_daily([*held, *BENCHMARKS], start)

    portfolio_1d, bench_1d, total_value = await _one_day_changes(market, held, cash)

    def changes_for(values) -> dict:
        return {
            r: change_percent(slice_for_range(values, r, today))
            for r in PERFORMANCE_RANGES
            if r != "1d"
        }

    bench_payload = {}
    for b in BENCHMARKS:
        values = [(date.fromisoformat(c.time), c.close) for c in bars[b]]
        bench_payload[b.lower()] = {
            "price": values[-1][1] if values else None,
            "changes": {"1d": bench_1d[b], **changes_for(values)},
        }

    portfolio_payload = None
    if held and authed:
        values = portfolio_values(
            {t: h.shares for t, h in held.items()}, bars, cash=cash
        )
        portfolio_payload = {
            "total_value": total_value,
            "changes": {"1d": portfolio_1d, **changes_for(values)},
        }
    return ok({
        "ranges": list(PERFORMANCE_RANGES),
        "portfolio": portfolio_payload,
        **bench_payload,
    })


@router.get("/performance")
async def performance(
    range_key: str = Query("1m", alias="range"),
    session: AsyncSession = Depends(get_session),
    market: MarketClient = Depends(get_market),
    store: PriceStore = Depends(get_price_store),
    _: None = Depends(require_unlock),
):
    if range_key not in PERFORMANCE_RANGES:
        return fail(
            f"range must be one of {', '.join(PERFORMANCE_RANGES)}", status_code=422
        )
    held = await _held(session)
    cash = float(await get_cash(session))
    today = datetime.now(timezone.utc).date()

    if range_key == "1d":
        portfolio_1d, bench_1d, _ = await _one_day_changes(market, held, cash)
        return ok({
            "range": "1d",
            "effective_start": None,
            "portfolio": (
                {"change_percent": portfolio_1d, "series": None} if held else None
            ),
            "voo": {"change_percent": bench_1d["VOO"], "series": None},
            "qqq": {"change_percent": bench_1d["QQQ"], "series": None},
        })

    start = min(
        today - timedelta(days=_MAX_HISTORY_DAYS), date(today.year, 1, 1)
    )
    bars = await store.get_daily([*held, *BENCHMARKS], start)

    portfolio_sliced = None
    effective_start: date | None = None
    if held:
        values = portfolio_values({t: h.shares for t, h in held.items()}, bars, cash=cash)
        portfolio_sliced = slice_for_range(values, range_key, today)
        if portfolio_sliced:
            effective_start = portfolio_sliced[0][0]

    def bench_payload(b: str) -> dict:
        values = [(date.fromisoformat(c.time), c.close) for c in bars[b]]
        sliced = slice_for_range(values, range_key, today)
        if effective_start is not None:
            sliced = [(d, v) for d, v in sliced if d >= effective_start]
        return {
            "change_percent": change_percent(sliced),
            "series": [asdict(p) for p in normalize(sliced)],
        }

    return ok({
        "range": range_key,
        "effective_start": (
            effective_start.isoformat() if effective_start else None
        ),
        "portfolio": (
            {
                "change_percent": change_percent(portfolio_sliced or []),
                "series": [asdict(p) for p in normalize(portfolio_sliced or [])],
            }
            if held else None
        ),
        "voo": bench_payload("VOO"),
        "qqq": bench_payload("QQQ"),
    })
