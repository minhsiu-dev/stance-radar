from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_price_store, get_session
from app.envelope import fail, ok
from app.insights.flips import StancePoint, detect_flips
from app.insights.scorecard import build_channel_performance, build_scorecard, build_scorecard_page
from app.market.store import PriceStore
from app.models import Channel, Stance, Video, VideoStance

router = APIRouter(prefix="/api")

_PERFORMANCE_WINDOW_DAYS = 180


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
    """Stance flips that occurred within the last N days (detection needs full history; the filter only looks at curr's time).

    When reversals_only=True, keep only buy<->sell reversals (excluding moves in/out of neutral). The filter runs
    before limit; otherwise limit would cut first and miss older reversals.
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


async def _channel_calls(
    session: AsyncSession, channel_id: str, cutoff: datetime | None = None
) -> list[dict]:
    conds = [
        Video.channel_id == channel_id,
        VideoStance.stance != Stance.neutral,
    ]
    if cutoff is not None:
        conds.append(Video.published_at >= cutoff)
    rows = (await session.execute(
        select(VideoStance, Video)
        .join(Video, VideoStance.video_id == Video.id)
        .where(*conds)
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
    session: AsyncSession,
    channel_id: str,
    page: int,
    page_size: int,
    stance: Stance | None = None,
    ticker: str | None = None,
) -> tuple[list[dict], int]:
    conds = [
        Video.channel_id == channel_id,
        VideoStance.stance != Stance.neutral,
    ]
    if stance is not None:
        conds.append(VideoStance.stance == stance)
    if ticker is not None:
        conds.append(VideoStance.ticker == ticker)
    total = (await session.execute(
        select(func.count())
        .select_from(VideoStance)
        .join(Video, VideoStance.video_id == Video.id)
        .where(*conds)
    )).scalar_one()
    rows = (await session.execute(
        select(VideoStance, Video)
        .join(Video, VideoStance.video_id == Video.id)
        .where(*conds)
        .order_by(Video.published_at.desc(), Video.id.desc(), VideoStance.ticker.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).all()
    calls = [
        {
            "video_id": video.id,
            "video_title": video.title,
            "ticker": stance_row.ticker,
            "stance": stance_row.stance.value,
            "confidence": stance_row.confidence,
            "summary": stance_row.summary,
            "published_at": video.published_at,
        }
        for stance_row, video in rows
    ]
    return calls, total


async def _channel_call_tickers(session: AsyncSession, channel_id: str) -> list[str]:
    return list((await session.execute(
        select(VideoStance.ticker)
        .join(Video, VideoStance.video_id == Video.id)
        .where(Video.channel_id == channel_id)
        .where(VideoStance.stance != Stance.neutral)
        .distinct()
        .order_by(VideoStance.ticker.asc())
    )).scalars().all())


@router.get("/channels/{channel_id}/scorecard")
async def channel_scorecard(
    channel_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    stance: str | None = Query(None),
    ticker: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
    store: PriceStore = Depends(get_price_store),
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"Channel {channel_id} not found", status_code=404)
    stance_filter = {"buy": Stance.buy, "sell": Stance.sell}.get(stance)
    calls, total = await _channel_calls_page(
        session, channel_id, page, page_size,
        stance=stance_filter, ticker=ticker,
    )
    scorecard = await build_scorecard_page(store, calls, total, page, page_size)
    # Full ticker list, independent of the active filters, so the dropdown stays populated.
    scorecard["tickers"] = await _channel_call_tickers(session, channel_id)
    return ok(scorecard)


@router.get("/channels/{channel_id}/performance")
async def channel_performance(
    channel_id: str,
    session: AsyncSession = Depends(get_session),
    store: PriceStore = Depends(get_price_store),
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"Channel {channel_id} not found", status_code=404)
    cutoff = datetime.now(timezone.utc) - timedelta(days=_PERFORMANCE_WINDOW_DAYS)
    raw_calls = await _channel_calls(session, channel_id, cutoff=cutoff)
    return ok(await build_channel_performance(
        store, raw_calls, window_days=_PERFORMANCE_WINDOW_DAYS,
    ))


@router.get("/insights/leaderboard")
async def channel_leaderboard(
    session: AsyncSession = Depends(get_session),
    store: PriceStore = Depends(get_price_store),
):
    """Leaderboard of all channels' 30-day call performance (sum over realized buy/sell calls)."""
    channels = (await session.execute(select(Channel))).scalars().all()
    headline = 30
    items = []
    for channel in channels:
        calls = await _channel_calls(session, channel.id)
        if not calls:
            continue
        scorecard = await build_scorecard(store, calls)
        aggregates = scorecard["aggregates"]
        # Single ranking metric: follow their calls (buy = go long, sell = avoid), 30-day average alpha
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
