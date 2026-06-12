import asyncio
import logging
from dataclasses import asdict

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_market, get_session
from app.envelope import ok
from app.market.client import MarketClient
from app.models import PortfolioTransaction
from app.portfolio.holdings import replay

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

GENERAL_TICKERS = ("VOO", "QQQ")
MAX_ITEMS = 8


@router.get("/news")
async def news(
    session: AsyncSession = Depends(get_session),
    market: MarketClient = Depends(get_market),
):
    txs = (await session.execute(select(PortfolioTransaction))).scalars().all()
    held = sorted(replay(list(txs)))
    tickers = held or list(GENERAL_TICKERS)
    scope = "holdings" if held else "general"

    results = await asyncio.gather(
        *(market.get_news(t) for t in tickers), return_exceptions=True
    )
    items = []
    seen: set[str] = set()
    for result in results:
        if isinstance(result, BaseException):
            logger.warning("news: fetch failed: %s", result)
            continue
        for n in result:
            if n.url in seen:
                continue
            seen.add(n.url)
            items.append(asdict(n))
    items.sort(key=lambda n: n["published_at"], reverse=True)
    return ok({"scope": scope, "items": items[:MAX_ITEMS]})
