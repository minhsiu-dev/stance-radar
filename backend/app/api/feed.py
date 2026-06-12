from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_session
from app.envelope import ok
from app.models import Video, VideoStatus

router = APIRouter(prefix="/api")

# 未挑選(discovered)與已略過(skipped)不進 feed
HIDDEN_STATUSES = (VideoStatus.discovered, VideoStatus.skipped)


@router.get("/feed")
async def feed(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    total = (await session.execute(
        select(func.count()).select_from(Video)
        .where(Video.status.not_in(HIDDEN_STATUSES))
    )).scalar_one()
    videos = (await session.execute(
        select(Video)
        .options(selectinload(Video.stances), selectinload(Video.channel))
        .where(Video.status.not_in(HIDDEN_STATUSES))
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
            "channel": {"id": v.channel.id, "title": v.channel.title},
            "stances": [
                {"ticker": s.ticker, "stance": s.stance.value, "summary": s.summary}
                for s in sorted(v.stances, key=lambda s: s.ticker)
            ],
        }
        for v in videos
    ]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})
