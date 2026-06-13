import re

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_runner, get_session, get_youtube
from app.envelope import fail, ok
from app.models import (
    Channel, JobKind, Stance, Video, VideoStance, VideoStatus, utcnow,
)
from app.pipeline.refresh import RefreshRunner
from app.youtube.client import ChannelNotFound, QuotaExceededError, YouTubeClient

router = APIRouter(prefix="/api/channels")


class AddChannelsRequest(BaseModel):
    channel_ids: str  # 換行/逗號/空白分隔,一個或多個


def parse_channel_ids(raw: str) -> list[str]:
    tokens = [t.strip() for t in re.split(r"[,\s]+", raw) if t.strip()]
    seen: set[str] = set()
    unique: list[str] = []
    for token in tokens:
        if token not in seen:
            seen.add(token)
            unique.append(token)
    return unique


def channel_to_dict(channel: Channel) -> dict:
    return {
        "id": channel.id,
        "title": channel.title,
        "thumbnail_url": channel.thumbnail_url,
        "auto_analyze": channel.auto_analyze,
        "added_at": channel.added_at.isoformat(),
        "last_refreshed_at": (
            channel.last_refreshed_at.isoformat() if channel.last_refreshed_at else None
        ),
    }


@router.post("")
async def add_channels(
    body: AddChannelsRequest,
    session: AsyncSession = Depends(get_session),
    youtube: YouTubeClient = Depends(get_youtube),
    runner: RefreshRunner = Depends(get_runner),
):
    channel_ids = parse_channel_ids(body.channel_ids)
    if not channel_ids:
        return fail("沒有可解析的 channel ID", status_code=400)

    existing = set((await session.execute(
        select(Channel.id).where(Channel.id.in_(channel_ids))
    )).scalars().all())

    added: list[dict] = []
    skipped: list[str] = []
    failed: list[dict] = []
    for channel_id in channel_ids:
        if channel_id in existing:
            skipped.append(channel_id)
            continue
        try:
            info = await youtube.resolve_channel(channel_id)
        except ChannelNotFound:
            failed.append({"id": channel_id, "reason": "查無此頻道"})
            continue
        except QuotaExceededError as exc:
            return fail(str(exc), status_code=503)
        channel = Channel(
            id=info.id, title=info.title, thumbnail_url=info.thumbnail_url,
            uploads_playlist_id=info.uploads_playlist_id,
            added_at=utcnow(),
        )
        session.add(channel)
        added.append(channel_to_dict(channel))
    await session.commit()

    job_id = None
    if added:
        job_id, _ = await runner.start(JobKind.discover)

    data = {"added": added, "skipped": skipped, "failed": failed, "job_id": job_id}
    if failed:
        # 部分失敗:400,但有效的照常加入(data 內含結果)
        return JSONResponse(
            status_code=400,
            content={"success": False, "data": data, "error": "部分 channel ID 無效"},
        )
    return ok(data)


@router.get("")
async def list_channels(session: AsyncSession = Depends(get_session)):
    channels = (await session.execute(
        select(Channel).order_by(Channel.added_at)
    )).scalars().all()
    count_rows = (await session.execute(
        select(Video.channel_id, Video.status, func.count())
        .group_by(Video.channel_id, Video.status)
    )).all()
    counts: dict[str, dict[str, int]] = {}
    for channel_id, status, n in count_rows:
        counts.setdefault(channel_id, {})[status.value] = n
    return ok([
        {**channel_to_dict(c), "video_counts": counts.get(c.id, {})}
        for c in channels
    ])


@router.get("/{channel_id}")
async def channel_detail(
    channel_id: str, session: AsyncSession = Depends(get_session)
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"頻道 {channel_id} 不存在", status_code=404)

    status_rows = (await session.execute(
        select(Video.status, func.count())
        .where(Video.channel_id == channel_id)
        .group_by(Video.status)
    )).all()
    status_counts = {status.value: n for status, n in status_rows}

    videos_count = func.count(VideoStance.video_id)
    top_rows = (await session.execute(
        select(
            VideoStance.ticker,
            videos_count.label("videos"),
            videos_count.filter(VideoStance.stance == Stance.buy).label("buy"),
            videos_count.filter(
                VideoStance.stance == Stance.neutral
            ).label("neutral"),
            videos_count.filter(VideoStance.stance == Stance.sell).label("sell"),
        )
        .join(Video, Video.id == VideoStance.video_id)
        .where(Video.channel_id == channel_id)
        .group_by(VideoStance.ticker)
        .order_by(videos_count.desc(), VideoStance.ticker)
        .limit(5)
    )).all()

    top_tickers = [row.ticker for row in top_rows]
    latest_map: dict[str, tuple[str, str]] = {}
    if top_tickers:
        ranked = (
            select(
                VideoStance.ticker,
                VideoStance.stance,
                Video.published_at,
                func.row_number().over(
                    partition_by=VideoStance.ticker,
                    order_by=Video.published_at.desc(),
                ).label("rn"),
            )
            .join(Video, Video.id == VideoStance.video_id)
            .where(
                Video.channel_id == channel_id,
                VideoStance.ticker.in_(top_tickers),
            )
            .subquery()
        )
        latest_rows = (await session.execute(
            select(ranked.c.ticker, ranked.c.stance, ranked.c.published_at)
            .where(ranked.c.rn == 1)
        )).all()
        latest_map = {
            ticker: (stance.value if hasattr(stance, "value") else stance,
                     published_at.date().isoformat())
            for ticker, stance, published_at in latest_rows
        }

    return ok({
        **channel_to_dict(channel),
        "status_counts": status_counts,
        "top_tickers": [
            {
                "ticker": row.ticker, "videos": row.videos,
                "buy": row.buy, "neutral": row.neutral, "sell": row.sell,
                "latest_stance": latest_map.get(row.ticker, (None, None))[0],
                "latest_date": latest_map.get(row.ticker, (None, None))[1],
            }
            for row in top_rows
        ],
    })


@router.get("/{channel_id}/videos")
async def channel_videos(
    channel_id: str,
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"頻道 {channel_id} 不存在", status_code=404)
    conditions = [Video.channel_id == channel_id]
    if status is not None:
        try:
            conditions.append(Video.status == VideoStatus(status))
        except ValueError:
            return fail(f"未知的影片狀態:{status}", status_code=400)

    total = (await session.execute(
        select(func.count()).select_from(Video).where(*conditions)
    )).scalar_one()
    videos = (await session.execute(
        select(Video)
        .options(selectinload(Video.stances))
        .where(*conditions)
        .order_by(Video.published_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()
    items = [
        {
            "id": v.id,
            "title": v.title,
            "thumbnail_url": v.thumbnail_url,
            "published_at": v.published_at.isoformat(),
            "duration_seconds": v.duration_seconds,
            "status": v.status.value,
            "error_message": v.error_message,
            "analyzed_at": v.analyzed_at.isoformat() if v.analyzed_at else None,
            "dropped_tickers": v.dropped_tickers or [],
            "stances": [
                {
                    "ticker": s.ticker,
                    "stance": s.stance.value,
                    "summary": s.summary,
                    "confidence": s.confidence,
                }
                for s in sorted(v.stances, key=lambda s: s.ticker)
            ],
        }
        for v in videos
    ]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})


class UpdateChannelRequest(BaseModel):
    auto_analyze: bool


@router.patch("/{channel_id}")
async def update_channel(
    channel_id: str,
    body: UpdateChannelRequest,
    session: AsyncSession = Depends(get_session),
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"頻道 {channel_id} 不存在", status_code=404)
    channel.auto_analyze = body.auto_analyze
    await session.commit()
    return ok(channel_to_dict(channel))


@router.delete("/{channel_id}")
async def delete_channel(
    channel_id: str, session: AsyncSession = Depends(get_session)
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"頻道 {channel_id} 不存在", status_code=404)
    await session.delete(channel)
    await session.commit()
    return ok({"deleted": channel_id})
