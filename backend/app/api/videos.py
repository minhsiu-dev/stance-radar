from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_runner, get_session
from app.envelope import fail, ok
from app.models import JobKind, Video, VideoStatus
from app.pipeline.refresh import RefreshRunner

router = APIRouter(prefix="/api/videos")


class VideoIdsRequest(BaseModel):
    video_ids: list[str]


def _video_to_dict(video: Video) -> dict:
    return {
        "id": video.id,
        "title": video.title,
        "thumbnail_url": video.thumbnail_url,
        "published_at": video.published_at.isoformat(),
        "duration_seconds": video.duration_seconds,
        "status": video.status.value,
    }


@router.get("")
async def list_videos(
    status: str = Query("discovered"),
    session: AsyncSession = Depends(get_session),
):
    try:
        wanted = VideoStatus(status)
    except ValueError:
        return fail(f"未知的影片狀態:{status}", status_code=400)
    videos = (await session.execute(
        select(Video)
        .options(selectinload(Video.channel))
        .where(Video.status == wanted)
        .order_by(Video.published_at.desc())
    )).scalars().all()

    groups: dict[str, dict] = {}
    for video in videos:
        group = groups.setdefault(video.channel_id, {
            "channel": {
                "id": video.channel.id,
                "title": video.channel.title,
                "thumbnail_url": video.channel.thumbnail_url,
            },
            "videos": [],
        })
        group["videos"].append(_video_to_dict(video))
    return ok({"groups": list(groups.values()), "total": len(videos)})


async def _load_videos(
    session: AsyncSession, raw_ids: list[str]
) -> tuple[list[Video] | None, object | None]:
    """整批驗證:任一 ID 無效就整批拒絕,不部分套用。"""
    ids = list(dict.fromkeys(raw_ids))
    if not ids:
        return None, fail("video_ids 不可為空", status_code=400)
    videos = (await session.execute(
        select(Video).where(Video.id.in_(ids))
    )).scalars().all()
    missing = set(ids) - {v.id for v in videos}
    if missing:
        return None, fail(
            f"影片不存在:{', '.join(sorted(missing))}", status_code=404
        )
    return list(videos), None


@router.post("/analyze")
async def analyze_videos(
    body: VideoIdsRequest,
    session: AsyncSession = Depends(get_session),
    runner: RefreshRunner = Depends(get_runner),
):
    videos, error = await _load_videos(session, body.video_ids)
    if error is not None:
        return error
    for video in videos:
        video.status = VideoStatus.pending
        video.error_message = None
    await session.commit()
    # created=False 表示已有 job 在跑;剛設成 pending 的影片會被下一個 analyze job 撿走
    job_id, created = await runner.start(JobKind.analyze)
    return ok({"job_id": job_id, "created": created, "queued": len(videos)})


@router.post("/skip")
async def skip_videos(
    body: VideoIdsRequest,
    session: AsyncSession = Depends(get_session),
):
    videos, error = await _load_videos(session, body.video_ids)
    if error is not None:
        return error
    analyzed = sorted(v.id for v in videos if v.status == VideoStatus.analyzed)
    if analyzed:
        return fail(
            f"已分析的影片不可略過:{', '.join(analyzed)}", status_code=400
        )
    for video in videos:
        video.status = VideoStatus.skipped
    await session.commit()
    return ok({"skipped": len(videos)})
