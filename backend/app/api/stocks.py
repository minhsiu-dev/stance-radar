import logging
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_market, get_price_store, get_session
from app.envelope import fail, ok
from app.market.client import RANGE_TO_FETCH, MarketClient, StockNotFound
from app.market.store import PriceStore
from app.models import Channel, Mention, Video, VideoStance

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stocks")

_FINANCIAL_PERIODS = {"quarterly", "annual"}

# 日 K 區間 → 往回的日曆天數(ytd 另計)
_DAILY_RANGE_DAYS = {"1m": 31, "3m": 93, "6m": 186, "1y": 366, "3y": 1096, "5y": 1827}
_INTRADAY_RANGES = {"1d", "5d"}


def daily_range_start(range_key: str, today: date) -> date:
    if range_key == "ytd":
        return date(today.year, 1, 1)
    return today - timedelta(days=_DAILY_RANGE_DAYS[range_key])


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


_TRENDING_HALF_LIFE_DAYS = 7.0


@router.get("/trending")
async def stocks_trending(
    limit: int = Query(12, ge=1, le=50),
    days: int = Query(90, ge=1, le=365),
    session: AsyncSession = Depends(get_session),
):
    """排序鍵 = 不重複頻道數;同分用最近一次提及、再用 ticker。
    score(時間衰減熱度)與 mention_count 仍回傳,供其他畫面使用。"""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    rows = (await session.execute(
        select(Mention.ticker, Video.channel_id, Video.published_at)
        .join(Video, Mention.video_id == Video.id)
        .where(Video.published_at >= cutoff)
    )).all()
    stats: dict[str, dict] = {}
    for ticker, channel_id, published_at in rows:
        age_days = max((now - published_at).total_seconds() / 86400, 0.0)
        entry = stats.setdefault(
            ticker,
            {"count": 0, "channels": set(), "score": 0.0, "last": published_at},
        )
        entry["count"] += 1
        entry["channels"].add(channel_id)
        entry["score"] += 0.5 ** (age_days / _TRENDING_HALF_LIFE_DAYS)
        entry["last"] = max(entry["last"], published_at)
    ranked = sorted(
        stats.items(),
        key=lambda kv: (-len(kv[1]["channels"]), -kv[1]["last"].timestamp(), kv[0]),
    )[:limit]
    return ok([
        {
            "ticker": ticker,
            "channel_count": len(entry["channels"]),
            "mention_count": entry["count"],
            "score": round(entry["score"], 4),
            "last_mentioned_at": entry["last"].isoformat(),
        }
        for ticker, entry in ranked
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


@router.get("/{ticker}/analyst")
async def stock_analyst(ticker: str, market: MarketClient = Depends(get_market)):
    try:
        data = await market.get_analyst(ticker.upper())
    except Exception:
        logger.exception("analyst fetch failed for %s", ticker)
        return fail("分析師資料暫時無法取得,稍後再試", status_code=502)
    return ok(asdict(data))


@router.get("/{ticker}/candles")
async def stock_candles(
    ticker: str,
    range_key: str = Query("1y", alias="range"),
    market: MarketClient = Depends(get_market),
    store: PriceStore = Depends(get_price_store),
):
    if range_key not in RANGE_TO_FETCH:
        return fail(
            f"range 必須是 {', '.join(sorted(RANGE_TO_FETCH))}", status_code=422
        )
    t = ticker.upper()
    try:
        if range_key in _INTRADAY_RANGES:
            candles = await market.get_candles(t, range_key)
        else:
            today = datetime.now(timezone.utc).date()
            candles = (await store.get_daily([t], daily_range_start(range_key, today)))[t]
            if not candles:
                return fail(f"查無股票 {t}", status_code=404)
    except StockNotFound:
        return fail(f"查無股票 {t}", status_code=404)
    except Exception:
        logger.exception("candles fetch failed for %s", ticker)
        return fail("行情資料暫時無法取得,稍後再試", status_code=502)
    return ok([asdict(c) for c in candles])


@router.get("/{ticker}/stance-summary")
async def stance_summary(
    ticker: str,
    days: int = Query(90, ge=1, le=3650),
    session: AsyncSession = Depends(get_session),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await session.execute(
        select(VideoStance.stance, func.count(Video.channel_id.distinct()))
        .join(Video, VideoStance.video_id == Video.id)
        .where(VideoStance.ticker == ticker.upper())
        .where(Video.published_at >= cutoff)
        .group_by(VideoStance.stance)
    )).all()
    counts = {"buy": 0, "neutral": 0, "sell": 0}
    for stance, c in rows:
        counts[stance.value] = c
    return ok({**counts, "window_days": days})


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
            "confidence": stance.confidence,
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
                "confidence": video_stance.confidence if video_stance else None,
                "youtube_url": f"https://www.youtube.com/watch?v={video.id}",
                "mentions": [],
            }
            video_mentions[video.id] = []
        video_mentions[video.id].append(mention)
        grouped[video.id]["mentions"].append({
            "start_seconds": mention.start_seconds,
            "quote": mention.quote,
            "stance": mention.stance.value,
            "confidence": mention.confidence,
            "time_horizon": mention.time_horizon,
            "is_conditional": mention.is_conditional,
            "condition": mention.condition,
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
