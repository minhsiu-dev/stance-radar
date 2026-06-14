from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_price_store, get_session
from app.envelope import fail, ok
from app.insights.flips import StancePoint, detect_flips
from app.insights.scorecard import build_scorecard, build_scorecard_page
from app.market.store import PriceStore
from app.models import Channel, Stance, Video, VideoStance

router = APIRouter(prefix="/api")


async def _load_stance_points(
    session: AsyncSession, channel_id: str | None = None
) -> list[StancePoint]:
    query = (
        select(VideoStance, Video, Channel)
        .join(Video, VideoStance.video_id == Video.id)
        .join(Channel, Video.channel_id == Channel.id)
    )
    if channel_id is not None:
        query = query.where(Channel.id == channel_id)
    rows = (await session.execute(query)).all()
    return [
        StancePoint(
            channel_id=channel.id,
            channel_title=channel.title,
            channel_thumbnail=channel.thumbnail_url,
            ticker=stance.ticker,
            stance=stance.stance.value,
            summary=stance.summary,
            video_id=video.id,
            video_title=video.title,
            published_at=video.published_at,
        )
        for stance, video, channel in rows
    ]


def _point_to_dict(point: StancePoint) -> dict:
    return {
        "video_id": point.video_id,
        "video_title": point.video_title,
        "stance": point.stance,
        "summary": point.summary,
        "published_at": point.published_at.isoformat(),
    }


@router.get("/insights/flips")
async def stance_flips(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(20, ge=1, le=100),
    reversals_only: bool = Query(False),
    session: AsyncSession = Depends(get_session),
):
    """近 N 天內發生的立場轉變(偵測需要全部歷史,過濾只看 curr 的時間)。

    reversals_only=True 時只留 buy↔sell 反轉(排除進出 neutral)。過濾在 limit
    之前做,否則 limit 會先砍掉、漏掉較舊的反轉。
    """
    points = await _load_stance_points(session)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    flips = [
        f for f in detect_flips(points)
        if f.curr.published_at >= cutoff
        and (not reversals_only or f.is_reversal)
    ][:limit]
    return ok({
        "window_days": days,
        "items": [
            {
                "channel_id": f.channel_id,
                "channel_title": f.channel_title,
                "channel_thumbnail": f.channel_thumbnail,
                "ticker": f.ticker,
                "direction": f.direction,
                "is_reversal": f.is_reversal,
                "prev": _point_to_dict(f.prev),
                "curr": _point_to_dict(f.curr),
            }
            for f in flips
        ],
    })


async def _channel_calls(session: AsyncSession, channel_id: str) -> list[dict]:
    rows = (await session.execute(
        select(VideoStance, Video)
        .join(Video, VideoStance.video_id == Video.id)
        .where(Video.channel_id == channel_id)
        .where(VideoStance.stance != Stance.neutral)
        .order_by(Video.published_at.desc())
    )).all()
    return [
        {
            "video_id": video.id,
            "video_title": video.title,
            "ticker": stance.ticker,
            "stance": stance.stance.value,
            "confidence": stance.confidence,
            "summary": stance.summary,
            "published_at": video.published_at,
        }
        for stance, video in rows
    ]


async def _channel_calls_page(
    session: AsyncSession, channel_id: str, page: int, page_size: int
) -> tuple[list[dict], int]:
    total = (await session.execute(
        select(func.count())
        .select_from(VideoStance)
        .join(Video, VideoStance.video_id == Video.id)
        .where(Video.channel_id == channel_id)
        .where(VideoStance.stance != Stance.neutral)
    )).scalar_one()
    rows = (await session.execute(
        select(VideoStance, Video)
        .join(Video, VideoStance.video_id == Video.id)
        .where(Video.channel_id == channel_id)
        .where(VideoStance.stance != Stance.neutral)
        .order_by(Video.published_at.desc(), Video.id.desc(), VideoStance.ticker.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).all()
    calls = [
        {
            "video_id": video.id,
            "video_title": video.title,
            "ticker": stance.ticker,
            "stance": stance.stance.value,
            "confidence": stance.confidence,
            "summary": stance.summary,
            "published_at": video.published_at,
        }
        for stance, video in rows
    ]
    return calls, total


@router.get("/channels/{channel_id}/scorecard")
async def channel_scorecard(
    channel_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    store: PriceStore = Depends(get_price_store),
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"Channel {channel_id} not found", status_code=404)
    calls, total = await _channel_calls_page(session, channel_id, page, page_size)
    scorecard = await build_scorecard_page(store, calls, total, page, page_size)
    return ok(scorecard)


@router.get("/insights/leaderboard")
async def channel_leaderboard(
    session: AsyncSession = Depends(get_session),
    store: PriceStore = Depends(get_price_store),
):
    """所有頻道的 30 天 call 表現排行(已實現的 buy/sell call 加總)。"""
    channels = (await session.execute(select(Channel))).scalars().all()
    headline = 30
    items = []
    for channel in channels:
        calls = await _channel_calls(session, channel.id)
        if not calls:
            continue
        scorecard = await build_scorecard(store, calls)
        aggregates = scorecard["aggregates"]
        # 單一排序指標:照他的話做(buy 做多、sell 視為避開),30 天平均 alpha
        signed: list[float] = []
        for call in scorecard["calls"]:
            alpha = call["alpha"].get(str(headline))
            if alpha is None:
                continue
            signed.append(alpha if call["stance"] == "buy" else -alpha)
        items.append({
            "channel_id": channel.id,
            "channel_title": channel.title,
            "channel_thumbnail": channel.thumbnail_url,
            "calls_total": len(scorecard["calls"]),
            "realized_30d": len(signed),
            "avg_call_alpha_30d": (
                round(sum(signed) / len(signed), 2) if signed else None
            ),
            "buy": aggregates["buy"]["horizons"][headline],
            "sell": aggregates["sell"]["horizons"][headline],
        })
    items.sort(
        key=lambda x: (
            x["avg_call_alpha_30d"] is not None,
            x["avg_call_alpha_30d"] or 0,
        ),
        reverse=True,
    )
    return ok({"horizon_days": headline, "benchmark": "SPY", "items": items})
