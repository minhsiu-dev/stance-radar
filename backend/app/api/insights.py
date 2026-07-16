from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.channels import channel_ticker_stance_mix
from app.api.deps import get_price_store, get_session
from app.envelope import fail, ok
from app.insights.channel_perf_sql import score_channel_calls_lean
from app.insights.scorecard import (
    SCORECARD_BENCHMARK,
    _SUMMARY_HORIZONS,
    build_scorecard,
    build_scorecard_page,
    summarize_channel_calls,
)
from app.insights.ticker_perf import channel_ticker_performance
from app.market.store import PriceStore
from app.models import Channel, Stance, Video, VideoStance

router = APIRouter(prefix="/api")

_PERFORMANCE_WINDOW_DAYS = 180

_EMPTY_PERF = {
    s: {"win_rate": None, "avg_alpha": None, "avg_return": None, "n": 0, "pending": 0}
    for s in ("all", "buy", "sell")
}


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
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"Channel {channel_id} not found", status_code=404)
    cutoff = datetime.now(timezone.utc) - timedelta(days=_PERFORMANCE_WINDOW_DAYS)
    calls = await score_channel_calls_lean(session, channel_id, cutoff)
    return ok({
        "benchmark": SCORECARD_BENCHMARK,
        "window_days": _PERFORMANCE_WINDOW_DAYS,
        "horizons": list(_SUMMARY_HORIZONS),
        **summarize_channel_calls(calls),
    })


@router.get("/channels/{channel_id}/tickers")
async def channel_tickers(
    channel_id: str,
    session: AsyncSession = Depends(get_session),
    store: PriceStore = Depends(get_price_store),
):
    """個股戰績: every ticker the channel covers (uncapped), stance mix left-joined
    to reversal-aware stance-adjusted performance vs VOO (each call scored to its
    reversal date, or to today if still open; calls <90d old are pending). Ensures
    price coverage with a lean ensure_daily (network only for cold tickers), then
    runs the indexed per-ticker SQL aggregation."""
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"Channel {channel_id} not found", status_code=404)

    mix = await channel_ticker_stance_mix(session, channel_id)
    # Earliest directional-call date -> coverage spans every call's entry.
    earliest = (await session.execute(
        select(func.min(Video.published_at))
        .join(VideoStance, VideoStance.video_id == Video.id)
        .where(Video.channel_id == channel_id, VideoStance.stance != Stance.neutral)
    )).scalar_one_or_none()
    perf: dict[str, dict] = {}
    perf_incl: dict[str, dict] = {}
    if earliest is not None:
        call_tickers = await _channel_call_tickers(session, channel_id)
        await store.ensure_daily(sorted(set(call_tickers) | {"VOO"}), earliest.date())
        perf = await channel_ticker_performance(session, channel_id)
        perf_incl = await channel_ticker_performance(session, channel_id, mode="incl")

    rows = [
        {
            **row,
            "perf": perf.get(row["ticker"], _EMPTY_PERF),
            "perf_incl": perf_incl.get(row["ticker"], _EMPTY_PERF),
        }
        for row in mix
    ]
    return ok(rows)


@router.get("/channels/{channel_id}/recent")
async def channel_recent(
    channel_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    """最新提及: newest-first digest grouped BY VIDEO (one item per video, its stances nested).
    Paginated by video so a video's tickers never split across a page boundary."""
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"Channel {channel_id} not found", status_code=404)
    total = (await session.execute(
        select(func.count(func.distinct(VideoStance.video_id)))
        .select_from(VideoStance)
        .join(Video, VideoStance.video_id == Video.id)
        .where(Video.channel_id == channel_id)
    )).scalar_one()
    video_rows = (await session.execute(
        select(Video.id, Video.title, Video.published_at)
        .join(VideoStance, VideoStance.video_id == Video.id)
        .where(Video.channel_id == channel_id)
        .group_by(Video.id, Video.title, Video.published_at)
        .order_by(Video.published_at.desc(), Video.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).all()
    video_ids = [r.id for r in video_rows]
    by_video: dict[str, list[dict]] = {vid: [] for vid in video_ids}
    if video_ids:
        stance_rows = (await session.execute(
            select(VideoStance)
            .where(VideoStance.video_id.in_(video_ids))
            .order_by(VideoStance.ticker.asc())
        )).scalars().all()
        for s in stance_rows:
            by_video[s.video_id].append({
                "ticker": s.ticker,
                "stance": s.stance.value,
                "summary": s.summary,
                "confidence": s.confidence,
            })
    items = [
        {
            "video_id": r.id,
            "video_title": r.title,
            "published_at": r.published_at.isoformat(),
            "stances": by_video.get(r.id, []),
        }
        for r in video_rows
    ]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})


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
