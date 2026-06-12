from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_session
from app.envelope import fail, ok
from app.models import Stance, Video, VideoStance, VideoStatus

router = APIRouter(prefix="/api")

# 未挑選(discovered)與已略過(skipped)不進 feed
HIDDEN_STATUSES = (VideoStatus.discovered, VideoStatus.skipped)


@router.get("/feed")
async def feed(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    channel_id: str | None = Query(None),
    ticker: str | None = Query(None),
    stance: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    conditions = [Video.status.not_in(HIDDEN_STATUSES)]
    if channel_id:
        conditions.append(Video.channel_id == channel_id)
    if ticker or stance:
        stance_conditions = [VideoStance.video_id == Video.id]
        if ticker:
            stance_conditions.append(VideoStance.ticker == ticker.upper())
        if stance:
            try:
                stance_conditions.append(VideoStance.stance == Stance(stance))
            except ValueError:
                return fail(f"未知的立場:{stance}", status_code=400)
        conditions.append(
            select(VideoStance).where(*stance_conditions).exists()
        )

    total = (await session.execute(
        select(func.count()).select_from(Video).where(*conditions)
    )).scalar_one()
    videos = (await session.execute(
        select(Video)
        .options(selectinload(Video.stances), selectinload(Video.channel))
        .where(*conditions)
        .order_by(Video.published_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()
    items = [
        {
            "video_id": v.id,
            "title": v.title,
            "thumbnail_url": v.thumbnail_url,
            "published_at": v.published_at.isoformat(),
            "status": v.status.value,
            "error_message": v.error_message,
            "dropped_tickers": v.dropped_tickers or [],
            "channel": {"id": v.channel.id, "title": v.channel.title},
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
