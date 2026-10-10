"""Read model for /api/pipeline: one query per question, never the transcript JSONB
(the page polls this every 3 seconds)."""
from datetime import datetime, timedelta

from sqlalchemy import Row, and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ANALYSIS_LANE, LANES, TRANSCRIPT_LANE, Channel, PipelineLane, Video, VideoStance,
    VideoStatus,
)

NEXT_LIMIT = 20
PROCESSING_LIMIT = 50  # more than any lane's slot count
DONE_LIMIT = 20
DONE_WINDOW = timedelta(hours=24)
LANE_INPUT = {
    TRANSCRIPT_LANE: VideoStatus.pending,
    ANALYSIS_LANE: VideoStatus.transcribed,
}

_VIDEO_COLUMNS = (
    Video.id, Video.title, Video.thumbnail_url, Video.published_at,
    Video.duration_seconds, Video.claimed_at,
    Channel.id.label("channel_id"), Channel.title.label("channel_title"),
)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _video_dict(row: Row) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "thumbnail_url": row.thumbnail_url,
        "channel": {"id": row.channel_id, "title": row.channel_title},
        "published_at": row.published_at.isoformat(),
        "duration_seconds": row.duration_seconds,
        "claimed_at": _iso(row.claimed_at),
    }


async def _queue_counts(session: AsyncSession) -> dict[tuple[VideoStatus, bool], int]:
    claimed = Video.claimed_at.is_not(None)
    rows = (await session.execute(
        select(Video.status, claimed, func.count())
        .where(Video.status.in_(
            (VideoStatus.discovered, VideoStatus.pending, VideoStatus.transcribed)
        ))
        .group_by(Video.status, claimed)
    )).all()
    return {(status, bool(is_claimed)): n for status, is_claimed, n in rows}


async def _failed_counts(session: AsyncSession) -> dict[str, int]:
    """A failed video's lane is the one its transcript presence says it died in."""
    missing = Video.transcript.is_(None)
    rows = (await session.execute(
        select(missing, func.count())
        .where(Video.status == VideoStatus.failed)
        .group_by(missing)
    )).all()
    by_missing = {bool(is_missing): n for is_missing, n in rows}
    return {TRANSCRIPT_LANE: by_missing.get(True, 0), ANALYSIS_LANE: by_missing.get(False, 0)}


async def _videos(
    session: AsyncSession, status: VideoStatus, *, claimed: bool, limit: int
) -> list[dict]:
    # Processing: longest-running first. Queued: the order the lane will claim them.
    order = Video.claimed_at.asc() if claimed else Video.published_at.desc()
    held = Video.claimed_at.is_not(None) if claimed else Video.claimed_at.is_(None)
    rows = (await session.execute(
        select(*_VIDEO_COLUMNS)
        .join(Channel, Channel.id == Video.channel_id)
        .where(Video.status == status, held)
        .order_by(order, Video.id.asc())
        .limit(limit)
    )).all()
    return [_video_dict(row) for row in rows]


async def _stances(session: AsyncSession, ids: list[str]) -> dict[str, list[dict]]:
    if not ids:
        return {}
    rows = (await session.execute(
        select(VideoStance.video_id, VideoStance.ticker, VideoStance.stance)
        .where(VideoStance.video_id.in_(ids))
        .order_by(VideoStance.ticker.asc())
    )).all()
    by_video: dict[str, list[dict]] = {}
    for video_id, ticker, stance in rows:
        by_video.setdefault(video_id, []).append({"ticker": ticker, "stance": stance.value})
    return by_video


async def _done(session: AsyncSession, since: datetime) -> dict:
    """Analyzed or no_transcript within the window: everything that reached the end
    and needs nothing from the operator. Failures stay in their own lane's column."""
    finished_at = case(
        (Video.status == VideoStatus.analyzed, Video.analyzed_at),
        else_=Video.last_attempt_at,
    )
    recent = or_(
        and_(Video.status == VideoStatus.analyzed, Video.analyzed_at >= since),
        and_(Video.status == VideoStatus.no_transcript, Video.last_attempt_at >= since),
    )
    total = (await session.execute(
        select(func.count()).select_from(Video).where(recent)
    )).scalar_one()
    rows = (await session.execute(
        select(*_VIDEO_COLUMNS, Video.status, finished_at.label("finished_at"))
        .join(Channel, Channel.id == Video.channel_id)
        .where(recent)
        .order_by(finished_at.desc(), Video.id.asc())
        .limit(DONE_LIMIT)
    )).all()
    stances = await _stances(session, [row.id for row in rows])
    items = [
        {
            **_video_dict(row),
            "status": row.status.value,
            "finished_at": _iso(row.finished_at),
            "stances": stances.get(row.id, []),
        }
        for row in rows
    ]
    return {"total": total, "items": items}


def _lane_dict(row: PipelineLane | None, now: datetime, offline_after: timedelta) -> dict:
    if row is None:  # never seeded: report it the way a worker that never started looks
        return {
            "paused": False, "pause_reason": None, "online": False, "concurrency": None,
            "consecutive_failures": 0, "last_error": None, "last_error_at": None,
            "last_heartbeat_at": None, "resume_at": None, "usage": None,
        }
    beat = row.last_heartbeat_at
    return {
        "paused": row.paused,
        "pause_reason": row.pause_reason,
        "online": beat is not None and now - beat <= offline_after,
        "concurrency": row.concurrency,
        "consecutive_failures": row.consecutive_failures,
        "last_error": row.last_error,
        "last_error_at": _iso(row.last_error_at),
        "last_heartbeat_at": _iso(beat),
        "resume_at": _iso(row.resume_at),
        "usage": row.usage,
    }


async def _lanes(session: AsyncSession, now: datetime, offline_after: timedelta) -> dict:
    rows = {row.lane: row for row in (await session.execute(select(PipelineLane))).scalars()}
    return {lane: _lane_dict(rows.get(lane), now, offline_after) for lane in LANES}


async def build_snapshot(
    session: AsyncSession, *, now: datetime, offline_after: timedelta
) -> dict:
    queues = await _queue_counts(session)
    failed = await _failed_counts(session)
    stages: dict = {"select": {"total": queues.get((VideoStatus.discovered, False), 0)}}
    for lane, status in LANE_INPUT.items():
        stages[lane] = {
            "queued": queues.get((status, False), 0),
            "failed": failed[lane],
            "processing": await _videos(session, status, claimed=True, limit=PROCESSING_LIMIT),
            "next": await _videos(session, status, claimed=False, limit=NEXT_LIMIT),
        }
    stages["done"] = await _done(session, now - DONE_WINDOW)
    return {"lanes": await _lanes(session, now, offline_after), "stages": stages}
