import re
from urllib.parse import urlparse

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
    channel_ids: str  # newline/comma/whitespace separated, one or more


def parse_channel_ids(raw: str) -> list[str]:
    tokens = [t.strip() for t in re.split(r"[,\s]+", raw) if t.strip()]
    seen: set[str] = set()
    unique: list[str] = []
    for token in tokens:
        if token not in seen:
            seen.add(token)
            unique.append(token)
    return unique


# Real channel IDs are UC + 22 chars; loosen to just the UC prefix so short test IDs also count as IDs
_CHANNEL_ID_RE = re.compile(r"^UC[A-Za-z0-9_-]+$")


def classify_channel_ref(token: str) -> tuple[str, str]:
    """Classify a user-pasted string into ('id', channel_id) or ('handle', handle).

    Supports: bare UC... ID, @handle, and YouTube links
    (/channel/UC..., /@handle, /c/Name, /user/Name, youtube.com/Name).
    When it can't be determined, always treat it as a handle and let forHandle resolve it.
    """
    t = token.strip()
    if "youtube.com" in t or "youtu.be" in t:
        path = urlparse(t if "//" in t else f"https://{t}").path
        segs = [s for s in path.split("/") if s]
        if segs:
            if segs[0] == "channel" and len(segs) > 1:
                return ("id", segs[1])
            if segs[0].startswith("@"):
                return ("handle", segs[0])
            if segs[0] in ("c", "user") and len(segs) > 1:
                return ("handle", segs[1])
            if len(segs) == 1:
                return ("handle", segs[0])
    if t.startswith("@"):
        return ("handle", t)
    if _CHANNEL_ID_RE.match(t):
        return ("id", t)
    return ("handle", t)


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
    tokens = parse_channel_ids(body.channel_ids)
    if not tokens:
        return fail("No parseable channel ID", status_code=400)

    # First resolve each token (ID / @handle / link) into a ChannelInfo
    added: list[dict] = []
    skipped: list[str] = []
    failed: list[dict] = []
    resolved: list[tuple[str, object]] = []  # (original token, ChannelInfo)
    for token in tokens:
        kind, value = classify_channel_ref(token)
        try:
            info = (
                await youtube.resolve_channel(value)
                if kind == "id"
                else await youtube.resolve_channel_by_handle(value)
            )
        except ChannelNotFound:
            failed.append({"id": token, "reason": "Channel not found"})
            continue
        except QuotaExceededError as exc:
            return fail(str(exc), status_code=503)
        resolved.append((token, info))

    # Deduplicate by resolved channel id (avoid double-adding when both an @handle and its UC ID are pasted)
    existing = set((await session.execute(
        select(Channel.id).where(Channel.id.in_([info.id for _, info in resolved]))
    )).scalars().all())
    seen_in_batch: set[str] = set()
    for token, info in resolved:
        if info.id in existing or info.id in seen_in_batch:
            skipped.append(token)
            continue
        seen_in_batch.add(info.id)
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
        # Partial failure: 400, but valid ones are still added (data carries the results)
        return JSONResponse(
            status_code=400,
            content={"success": False, "data": data, "error": "Some channel IDs are invalid"},
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
        return fail(f"Channel {channel_id} not found", status_code=404)

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
                    order_by=[Video.published_at.desc(), VideoStance.video_id.desc()],
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
                "latest_stance": (ls := latest_map.get(row.ticker, (None, None)))[0],
                "latest_date": ls[1],
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
        return fail(f"Channel {channel_id} not found", status_code=404)
    conditions = [Video.channel_id == channel_id]
    if status is not None:
        try:
            conditions.append(Video.status == VideoStatus(status))
        except ValueError:
            return fail(f"Unknown video status: {status}", status_code=400)

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
        return fail(f"Channel {channel_id} not found", status_code=404)
    channel.auto_analyze = body.auto_analyze
    await session.commit()
    return ok(channel_to_dict(channel))


@router.post("/{channel_id}/load-older")
async def load_older(
    channel_id: str,
    session: AsyncSession = Depends(get_session),
    runner: RefreshRunner = Depends(get_runner),
):
    if await session.get(Channel, channel_id) is None:
        return fail(f"Channel {channel_id} not found", status_code=404)
    job_id, created = await runner.start(JobKind.load_older, channel_id=channel_id)
    return ok({"job_id": job_id, "created": created})


@router.delete("/{channel_id}")
async def delete_channel(
    channel_id: str, session: AsyncSession = Depends(get_session)
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"Channel {channel_id} not found", status_code=404)
    await session.delete(channel)
    await session.commit()
    return ok({"deleted": channel_id})
