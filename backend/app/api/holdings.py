import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.auth import require_admin
from app.envelope import fail, ok
from app.models import Holding

router = APIRouter(prefix="/api/holdings")

_SPLIT = re.compile(r"[\s,;]+")

# Matches Holding.ticker's String(10) column -- validate before INSERT instead of letting an
# over-length token surface as an uncaught Postgres DataError (500) on commit.
_MAX_TICKER_LEN = Holding.__table__.c.ticker.type.length

# Admin-only endpoint, but this host is publicly tunnelled -- cap the request so a pasted wall
# of text can't build an unbounded IN(...) / insert loop.
_MAX_TICKERS_PER_REQUEST = 200


def parse_tickers(raw: str) -> list[str]:
    """Whitespace/comma/semicolon separated -> uppercased, de-duplicated, order kept."""
    out: list[str] = []
    for part in _SPLIT.split(raw.strip()):
        t = part.strip().upper()
        if t and t not in out:
            out.append(t)
    return out


class AddBody(BaseModel):
    tickers: str


@router.get("")
async def list_holdings(
    session: AsyncSession = Depends(get_session),
    _: None = Depends(require_admin),
):
    rows = (await session.execute(select(Holding).order_by(Holding.ticker))).scalars().all()
    return ok([
        {"ticker": h.ticker, "added_at": h.added_at.isoformat(), "note": h.note}
        for h in rows
    ])


@router.post("")
async def add_holdings(
    body: AddBody,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(require_admin),
):
    tickers = parse_tickers(body.tickers)
    if not tickers:
        return fail("tickers must contain at least one symbol", status_code=422)
    if len(tickers) > _MAX_TICKERS_PER_REQUEST:
        return fail(
            f"too many tickers in one request ({len(tickers)} > {_MAX_TICKERS_PER_REQUEST} max)",
            status_code=422,
        )
    too_long = [t for t in tickers if len(t) > _MAX_TICKER_LEN]
    if too_long:
        # Reject the whole request rather than partially applying it: nothing below this point
        # has touched the session yet, so one bad token in a pasted list can't silently drop
        # the good ones or leave a half-committed batch.
        return fail(
            f"ticker(s) longer than {_MAX_TICKER_LEN} characters: {', '.join(too_long)}",
            status_code=422,
        )
    existing = set((await session.execute(
        select(Holding.ticker).where(Holding.ticker.in_(tickers))
    )).scalars().all())
    added = [t for t in tickers if t not in existing]
    for t in added:
        session.add(Holding(ticker=t))
    await session.commit()
    return ok({"added": added, "skipped": [t for t in tickers if t in existing]})


@router.delete("/{ticker}")
async def delete_holding(
    ticker: str,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(require_admin),
):
    holding = await session.get(Holding, ticker.upper())
    if holding is None:
        return fail(f"{ticker.upper()} is not in your holdings", status_code=404)
    await session.delete(holding)
    await session.commit()
    return ok({"ticker": ticker.upper()})
