import logging
from dataclasses import asdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_market, get_session
from app.envelope import fail, ok
from app.market.client import RANGE_TO_PERIOD, MarketClient, StockNotFound
from app.models import Channel, Mention, Video, VideoStance

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stocks")


@router.get("")
async def list_stocks(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(Mention.ticker, func.count(Mention.id))
        .group_by(Mention.ticker)
        .order_by(func.count(Mention.id).desc(), Mention.ticker)
    )).all()
    return ok([{"ticker": t, "mention_count": c} for t, c in rows])


@router.get("/search")
async def stock_search(
    q: str = Query("", description="ticker or company name fragment"),
    market: MarketClient = Depends(get_market),
):
    if not q.strip():
        return fail("q must be non-empty", status_code=422)
    try:
        hits = await market.search(q.strip())
    except Exception:
        logger.exception("search failed for %s", q)
        return fail("搜尋暫時無法使用,稍後再試", status_code=502)
    return ok([asdict(h) for h in hits])


@router.get("/{ticker}")
async def stock_summary(ticker: str, market: MarketClient = Depends(get_market)):
    try:
        summary = await market.get_summary(ticker.upper())
    except StockNotFound:
        return fail(f"查無股票 {ticker.upper()}", status_code=404)
    except Exception:
        logger.exception("summary fetch failed for %s", ticker)
        return fail("行情資料暫時無法取得,稍後再試", status_code=502)
    return ok(asdict(summary))


@router.get("/{ticker}/candles")
async def stock_candles(
    ticker: str,
    range_key: str = Query("1y", alias="range"),
    market: MarketClient = Depends(get_market),
):
    if range_key not in RANGE_TO_PERIOD:
        return fail(
            f"range 必須是 {', '.join(sorted(RANGE_TO_PERIOD))}", status_code=422
        )
    try:
        candles = await market.get_candles(ticker.upper(), range_key)
    except StockNotFound:
        return fail(f"查無股票 {ticker.upper()}", status_code=404)
    except Exception:
        logger.exception("candles fetch failed for %s", ticker)
        return fail("行情資料暫時無法取得,稍後再試", status_code=502)
    return ok([asdict(c) for c in candles])


@router.get("/{ticker}/stances")
async def stock_stances(ticker: str, session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(VideoStance, Video, Channel)
        .join(Video, VideoStance.video_id == Video.id)
        .join(Channel, Video.channel_id == Channel.id)
        .where(VideoStance.ticker == ticker.upper())
        .order_by(Video.published_at.asc())  # chart 標記需要時間遞增
    )).all()
    return ok([
        {
            "video_id": video.id,
            "video_title": video.title,
            "channel_id": channel.id,
            "channel_title": channel.title,
            "published_at": video.published_at.isoformat(),
            "stance": stance.stance.value,
            "summary": stance.summary,
        }
        for stance, video, channel in rows
    ])


@router.get("/{ticker}/mentions")
async def stock_mentions(ticker: str, session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(Mention, Video, Channel)
        .join(Video, Mention.video_id == Video.id)
        .join(Channel, Video.channel_id == Channel.id)
        .where(Mention.ticker == ticker.upper())
        .order_by(Video.published_at.desc(), Mention.start_seconds.asc())
    )).all()
    return ok([
        {
            "video_id": video.id,
            "video_title": video.title,
            "channel_id": channel.id,
            "channel_title": channel.title,
            "published_at": video.published_at.isoformat(),
            "start_seconds": mention.start_seconds,
            "quote": mention.quote,
            "stance": mention.stance.value,
            "reasoning": mention.reasoning,
            "youtube_url": (
                f"https://www.youtube.com/watch?v={video.id}"
                f"&t={int(mention.start_seconds)}s"
            ),
        }
        for mention, video, channel in rows
    ])
