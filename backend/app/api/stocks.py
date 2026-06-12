import logging
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_market, get_session
from app.envelope import fail, ok
from app.market.client import RANGE_TO_FETCH, MarketClient, StockNotFound
from app.models import Channel, Mention, Video, VideoStance

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stocks")

_FINANCIAL_PERIODS = {"quarterly", "annual"}


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


@router.get("/trending")
async def stocks_trending(
    limit: int = Query(12, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    rows = (await session.execute(
        select(
            Mention.ticker,
            func.count(Mention.id).label("cnt"),
            func.max(Video.published_at).label("last_mentioned_at"),
        )
        .join(Video, Mention.video_id == Video.id)
        .where(Video.published_at >= cutoff)
        .group_by(Mention.ticker)
        .order_by(
            func.max(Video.published_at).desc(),
            func.count(Mention.id).desc(),
        )
        .limit(limit)
    )).all()
    return ok([
        {
            "ticker": ticker,
            "mention_count": cnt,
            "last_mentioned_at": last.isoformat(),
        }
        for ticker, cnt, last in rows
    ])


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


@router.get("/{ticker}/financials")
async def stock_financials(
    ticker: str,
    period: str = Query("quarterly"),
    market: MarketClient = Depends(get_market),
):
    if period not in _FINANCIAL_PERIODS:
        return fail(
            f"period 必須是 {', '.join(sorted(_FINANCIAL_PERIODS))}",
            status_code=422,
        )
    try:
        reports = await market.get_financials(ticker.upper(), period)  # type: ignore[arg-type]
    except StockNotFound:
        return fail(f"查無股票 {ticker.upper()}", status_code=404)
    except Exception:
        logger.exception("financials fetch failed for %s", ticker)
        return fail("財報資料暫時無法取得,稍後再試", status_code=502)
    return ok([asdict(r) for r in reports])


@router.get("/{ticker}/candles")
async def stock_candles(
    ticker: str,
    range_key: str = Query("1y", alias="range"),
    market: MarketClient = Depends(get_market),
):
    if range_key not in RANGE_TO_FETCH:
        return fail(
            f"range 必須是 {', '.join(sorted(RANGE_TO_FETCH))}", status_code=422
        )
    try:
        candles = await market.get_candles(ticker.upper(), range_key)
    except StockNotFound:
        return fail(f"查無股票 {ticker.upper()}", status_code=404)
    except Exception:
        logger.exception("candles fetch failed for %s", ticker)
        return fail("行情資料暫時無法取得,稍後再試", status_code=502)
    return ok([asdict(c) for c in candles])


@router.get("/{ticker}/stance-summary")
async def stance_summary(
    ticker: str,
    session: AsyncSession = Depends(get_session),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    rows = (await session.execute(
        select(VideoStance.stance, func.count(VideoStance.video_id))
        .join(Video, VideoStance.video_id == Video.id)
        .where(VideoStance.ticker == ticker.upper())
        .where(Video.published_at >= cutoff)
        .group_by(VideoStance.stance)
    )).all()
    counts = {"buy": 0, "neutral": 0, "sell": 0}
    for stance, c in rows:
        counts[stance.value] = c
    return ok({**counts, "window_days": 90})


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


def _majority_stance(mentions: list[Mention]) -> str:
    counts = {"buy": 0, "neutral": 0, "sell": 0}
    for m in mentions:
        counts[m.stance.value] += 1
    return max(counts, key=lambda k: counts[k])


@router.get("/{ticker}/mentions")
async def stock_mentions(ticker: str, session: AsyncSession = Depends(get_session)):
    """一部影片一列:stance 取整部影片的總體立場,timestamps 列出每次提及。"""
    rows = (await session.execute(
        select(Mention, Video, Channel, VideoStance)
        .join(Video, Mention.video_id == Video.id)
        .join(Channel, Video.channel_id == Channel.id)
        .outerjoin(
            VideoStance,
            (VideoStance.video_id == Mention.video_id)
            & (VideoStance.ticker == Mention.ticker),
        )
        .where(Mention.ticker == ticker.upper())
        .order_by(Video.published_at.desc(), Mention.start_seconds.asc())
    )).all()

    grouped: dict[str, dict] = {}
    video_mentions: dict[str, list[Mention]] = {}
    for mention, video, channel, video_stance in rows:
        if video.id not in grouped:
            grouped[video.id] = {
                "video_id": video.id,
                "video_title": video.title,
                "channel_id": channel.id,
                "channel_title": channel.title,
                "channel_thumbnail": channel.thumbnail_url,
                "published_at": video.published_at.isoformat(),
                "stance": video_stance.stance.value if video_stance else None,
                "summary": video_stance.summary if video_stance else None,
                "youtube_url": f"https://www.youtube.com/watch?v={video.id}",
                "mentions": [],
            }
            video_mentions[video.id] = []
        video_mentions[video.id].append(mention)
        grouped[video.id]["mentions"].append({
            "start_seconds": mention.start_seconds,
            "quote": mention.quote,
            "context_before": mention.context_before,
            "context_after": mention.context_after,
            "youtube_url": (
                f"https://www.youtube.com/watch?v={video.id}"
                f"&t={int(mention.start_seconds)}s"
            ),
        })
    # 舊資料可能沒有 VideoStance → 以逐筆 mention 多數決補上
    result = [
        row if row["stance"] is not None
        else {**row, "stance": _majority_stance(video_mentions[row["video_id"]])}
        for row in grouped.values()
    ]
    return ok(result)
