from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_price_store, get_runner, get_session
from app.auth import require_admin
from app.envelope import fail, ok
from app.models import (
    Channel, JobKind, Mention, Stance, Video, VideoStance, VideoStatus,
)
from app.pipeline.refresh import RefreshRunner
from app.insights.scorecard import build_scorecard_page
from app.market.store import PriceStore

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
    """Validate the whole batch: if any ID is invalid, reject the entire batch -- no partial application."""
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
    _: None = Depends(require_admin),
):
    videos, error = await _load_videos(session, body.video_ids)
    if error is not None:
        return error
    for video in videos:
        video.status = VideoStatus.pending
        video.error_message = None
    await session.commit()
    # created=False means a job is already running; videos just set to pending will be picked up by the next analyze job
    job_id, created = await runner.enqueue(JobKind.analyze)
    return ok({"job_id": job_id, "created": created, "queued": len(videos)})


@router.post("/skip")
async def skip_videos(
    body: VideoIdsRequest,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(require_admin),
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


# --- Failed-video triage -------------------------------------------------------
# NOTE: every /failures route must stay ABOVE @router.get("/{video_id}") below --
# that catch-all would otherwise match "failures" as a video id and return 404.

FAILURE_KINDS = ("transcript", "analysis")


def _failure_conditions(
    kind: str | None, channel_id: str | None, max_attempts: int | None
) -> list:
    """Shared selection rule for the summary / items / retry endpoints, so the
    three can never disagree about which videos a filter covers.

    `kind` is derived, not stored: _process_video only fetches a transcript when
    none is saved, so "failed with no transcript" *is* "died fetching", and
    "failed with a transcript" *is* "died in the LLM".
    """
    conditions = [Video.status == VideoStatus.failed]
    if kind == "transcript":
        conditions.append(Video.transcript.is_(None))
    elif kind == "analysis":
        conditions.append(Video.transcript.is_not(None))
    if channel_id is not None:
        conditions.append(Video.channel_id == channel_id)
    if max_attempts is not None:
        conditions.append(Video.analysis_attempts < max_attempts)
    return conditions


async def _count_failures(session: AsyncSession, conditions: list) -> int:
    return (await session.execute(
        select(func.count()).select_from(Video).where(*conditions)
    )).scalar_one()


@router.get("/failures")
async def failures_summary(
    channel_id: str | None = Query(None),
    max_attempts: int | None = Query(None, ge=1),
    session: AsyncSession = Depends(get_session),
):
    groups = []
    for kind in FAILURE_KINDS:
        groups.append({
            "kind": kind,
            "total": await _count_failures(
                session, _failure_conditions(kind, channel_id, None)
            ),
            "retryable": await _count_failures(
                session, _failure_conditions(kind, channel_id, max_attempts)
            ),
        })
    # The channels list always ignores channel_id (and kind) on purpose: it feeds
    # the channel dropdown, which would collapse to a single option if it filtered
    # itself on the very selection it is meant to offer. `groups` above, by
    # contrast, IS scoped to channel_id when given, so its totals stay consistent
    # with what /failures/items and /failures/retry would return for the same filter.
    channel_rows = (await session.execute(
        select(Channel.id, Channel.title, func.count(Video.id))
        .join(Video, Video.channel_id == Channel.id)
        .where(Video.status == VideoStatus.failed)
        .group_by(Channel.id, Channel.title)
        .order_by(func.count(Video.id).desc(), Channel.title.asc())
    )).all()
    return ok({
        "groups": groups,
        "channels": [
            {"id": cid, "title": title, "total": n} for cid, title, n in channel_rows
        ],
        "total": sum(g["total"] for g in groups),
    })


@router.get("/failures/items")
async def failures_items(
    kind: str | None = Query(None),
    channel_id: str | None = Query(None),
    max_attempts: int | None = Query(None, ge=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    if kind is not None and kind not in FAILURE_KINDS:
        return fail(f"Unknown failure kind: {kind}", status_code=400)
    conditions = _failure_conditions(kind, channel_id, max_attempts)
    total = await _count_failures(session, conditions)
    videos = (await session.execute(
        select(Video)
        .options(selectinload(Video.channel))
        .where(*conditions)
        .order_by(Video.published_at.desc(), Video.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()
    return ok({
        "items": [
            {
                "id": v.id,
                "title": v.title,
                "thumbnail_url": v.thumbnail_url,
                "channel": {"id": v.channel.id, "title": v.channel.title},
                "published_at": v.published_at.isoformat(),
                "duration_seconds": v.duration_seconds,
                "error_message": v.error_message,
                "analysis_attempts": v.analysis_attempts,
                "last_attempt_at": (
                    v.last_attempt_at.isoformat() if v.last_attempt_at else None
                ),
            }
            for v in videos
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    })


class RetryFailuresRequest(BaseModel):
    kind: str | None = None
    channel_id: str | None = None
    max_attempts: int | None = Field(None, ge=1)


@router.post("/failures/retry")
async def retry_failures(
    body: RetryFailuresRequest,
    session: AsyncSession = Depends(get_session),
    runner: RefreshRunner = Depends(get_runner),
    _: None = Depends(require_admin),
):
    if body.kind is not None and body.kind not in FAILURE_KINDS:
        return fail(f"Unknown failure kind: {body.kind}", status_code=400)
    # Select ids only -- not full Video rows -- so this doesn't pull every matched
    # video's `transcript` JSONB into memory just to flip two columns (the
    # analysis-class group alone is dozens of videos, each with a stored transcript).
    ids = (await session.execute(
        select(Video.id).where(
            *_failure_conditions(body.kind, body.channel_id, body.max_attempts)
        )
    )).scalars().all()
    if not ids:
        return ok({"queued": 0, "job_id": None, "created": False})
    await session.execute(
        update(Video)
        .where(Video.id.in_(ids))
        .values(status=VideoStatus.pending, error_message=None)
        # analysis_attempts is deliberately NOT touched: it is the only record that
        # distinguishes "blocked once" from "blocked twelve times", which is exactly
        # what the max_attempts threshold spends.
    )
    await session.commit()
    # created=False means a job is already running; the pending videos fold into its drain.
    job_id, created = await runner.enqueue(JobKind.analyze)
    return ok({"queued": len(ids), "job_id": job_id, "created": created})


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

    # Sort groups by "first mention seconds" (mentions are already in ascending seconds)
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
            "tldr": video.tldr,
        },
        "groups": ordered,
    })


async def _video_calls(session: AsyncSession, video: Video) -> list[dict]:
    rows = (await session.execute(
        select(VideoStance)
        .where(VideoStance.video_id == video.id)
        .where(VideoStance.stance != Stance.neutral)
        .order_by(VideoStance.ticker.asc())
    )).scalars().all()
    return [
        {
            "video_id": video.id,
            "video_title": video.title,
            "ticker": s.ticker,
            "stance": s.stance.value,
            "confidence": s.confidence,
            "summary": s.summary,
            "published_at": video.published_at,
        }
        for s in rows
    ]


@router.get("/{video_id}/scorecard")
async def video_scorecard(
    video_id: str,
    session: AsyncSession = Depends(get_session),
    store: PriceStore = Depends(get_price_store),
):
    video = await session.get(Video, video_id)
    if video is None:
        return fail(f"Video not found: {video_id}", status_code=404)
    calls = await _video_calls(session, video)
    scorecard = await build_scorecard_page(
        store, calls, total=len(calls), page=1, page_size=max(len(calls), 1)
    )
    return ok(scorecard)
