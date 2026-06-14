from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_runner, get_session
from app.envelope import fail, ok
from app.models import JobKind, Mention, Video, VideoStance, VideoStatus
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
        return fail(f"Unknown video status: {status}", status_code=400)
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
        return None, fail("video_ids must not be empty", status_code=400)
    videos = (await session.execute(
        select(Video).where(Video.id.in_(ids))
    )).scalars().all()
    missing = set(ids) - {v.id for v in videos}
    if missing:
        return None, fail(
            f"Video not found: {', '.join(sorted(missing))}", status_code=404
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
            f"Analyzed videos cannot be skipped: {', '.join(analyzed)}", status_code=400
        )
    for video in videos:
        video.status = VideoStatus.skipped
    await session.commit()
    return ok({"skipped": len(videos)})


@router.get("/{video_id}")
async def video_detail(
    video_id: str,
    session: AsyncSession = Depends(get_session),
):
    video = (await session.execute(
        select(Video)
        .options(selectinload(Video.channel))
        .where(Video.id == video_id)
    )).scalar_one_or_none()
    if video is None:
        return fail(f"Video not found: {video_id}", status_code=404)

    mentions = (await session.execute(
        select(Mention)
        .where(Mention.video_id == video_id)
        .order_by(Mention.start_seconds.asc())
    )).scalars().all()
    stances = (await session.execute(
        select(VideoStance).where(VideoStance.video_id == video_id)
    )).scalars().all()
    stance_by_ticker = {s.ticker: s for s in stances}

    groups: dict[str, dict] = {}
    for m in mentions:
        group = groups.get(m.ticker)
        if group is None:
            vs = stance_by_ticker.get(m.ticker)
            group = groups[m.ticker] = {
                "ticker": m.ticker,
                "stance": vs.stance.value if vs else m.stance.value,
                "summary": vs.summary if vs else None,
                "confidence": vs.confidence if vs else None,
                "mentions": [],
            }
        group["mentions"].append({
            "start_seconds": m.start_seconds,
            "quote": m.quote,
            "excerpt": m.excerpt,
            "stance": m.stance.value,
            "confidence": m.confidence,
            "time_horizon": m.time_horizon,
            "is_conditional": m.is_conditional,
            "condition": m.condition,
        })

    # 群組依「首次提及秒數」排序(mentions 已按秒數遞增)
    ordered = sorted(groups.values(), key=lambda g: g["mentions"][0]["start_seconds"])
    return ok({
        "video": {
            "id": video.id,
            "title": video.title,
            "channel": {
                "id": video.channel.id,
                "title": video.channel.title,
                "thumbnail_url": video.channel.thumbnail_url,
            },
            "published_at": video.published_at.isoformat(),
            "duration_seconds": video.duration_seconds,
            "status": video.status.value,
        },
        "groups": ordered,
    })
