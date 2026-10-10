"""DB operations the pipeline lanes share: per-video claims and per-lane state.

Every function opens its own short session, so a lane holds no connection while a
transcript fetch or a five-minute `claude` call is in flight.
"""
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, String, and_, case, func, literal, or_, select, update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.analysis.types import UsageSnapshot
from app.models import LANES, PipelineLane, Video, VideoStatus, utcnow

Sessionmaker = async_sessionmaker[AsyncSession]

MANUAL = "manual"
AUTO = "auto"
LIMIT = "limit"


async def ensure_lanes(sessionmaker: Sessionmaker) -> None:
    """Same rows the startup migration seeds; lets a lane run against a database the
    api's migrations have not touched (tests build their schema with create_all)."""
    async with sessionmaker() as session:
        await session.execute(
            insert(PipelineLane)
            .values([{"lane": lane} for lane in LANES])
            .on_conflict_do_nothing(index_elements=[PipelineLane.lane])
        )
        await session.commit()


async def claim_next(sessionmaker: Sessionmaker, status: VideoStatus) -> str | None:
    """Claim the newest unclaimed video in `status`, or None when there is none.

    SKIP LOCKED lets the slots of one lane, and an api request holding a row it is
    about to re-status (api/videos.py _load_videos), pass each other without
    blocking or double-claiming.
    """
    async with sessionmaker() as session:
        video_id = (await session.execute(
            select(Video.id)
            .where(Video.status == status, Video.claimed_at.is_(None))
            .order_by(Video.published_at.desc(), Video.id.asc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )).scalar_one_or_none()
        if video_id is None:
            return None
        await session.execute(
            update(Video).where(Video.id == video_id).values(claimed_at=utcnow())
        )
        await session.commit()
        return video_id


async def release_claims(sessionmaker: Sessionmaker, status: VideoStatus) -> int:
    """Startup recovery: drop the claims a previous process of this lane left behind.
    Scoped to the lane's own input status, so worker-analyze restarting never
    touches a video the transcript lane is fetching."""
    async with sessionmaker() as session:
        result = await session.execute(
            update(Video)
            .where(Video.status == status, Video.claimed_at.is_not(None))
            .values(claimed_at=None)
        )
        await session.commit()
        return result.rowcount


async def fail_video(
    sessionmaker: Sessionmaker, video_id: str, error: str, *, status: VideoStatus | None = None
) -> None:
    async with sessionmaker() as session:
        where_clause = [Video.id == video_id]
        if status is not None:
            where_clause.append(Video.status == status)
        await session.execute(
            update(Video)
            .where(*where_clause)
            .values(status=VideoStatus.failed, error_message=error, claimed_at=None)
        )
        await session.commit()


async def _update_lane(sessionmaker: Sessionmaker, lane: str, **values: object) -> None:
    async with sessionmaker() as session:
        await session.execute(
            update(PipelineLane).where(PipelineLane.lane == lane).values(**values)
        )
        await session.commit()


async def mark_started(sessionmaker: Sessionmaker, lane: str, concurrency: int) -> None:
    await _update_lane(
        sessionmaker, lane, concurrency=concurrency, last_heartbeat_at=utcnow()
    )


async def heartbeat(sessionmaker: Sessionmaker, lane: str) -> None:
    await _update_lane(sessionmaker, lane, last_heartbeat_at=utcnow())


async def is_paused(sessionmaker: Sessionmaker, lane: str) -> bool:
    async with sessionmaker() as session:
        paused = (await session.execute(
            select(PipelineLane.paused).where(PipelineLane.lane == lane)
        )).scalar_one_or_none()
    return bool(paused)


async def record_success(sessionmaker: Sessionmaker, lane: str) -> None:
    await _update_lane(sessionmaker, lane, consecutive_failures=0)


async def record_failure(
    sessionmaker: Sessionmaker, lane: str, error: str, *, pause_after: int
) -> bool:
    """Count one failure; pause the lane once the streak reaches pause_after.

    Returns whether the lane is paused afterwards. One UPDATE, so two slots failing
    at the same moment can't both read the old streak. A lane someone already paused
    by hand keeps its "manual" reason.
    """
    now = utcnow()
    streak = PipelineLane.consecutive_failures + 1
    trips = and_(streak >= pause_after, PipelineLane.paused.is_(False))
    async with sessionmaker() as session:
        paused = (await session.execute(
            update(PipelineLane)
            .where(PipelineLane.lane == lane)
            .values(
                consecutive_failures=streak,
                last_error=error,
                last_error_at=now,
                paused=case((trips, literal(True, Boolean)), else_=PipelineLane.paused),
                pause_reason=case(
                    (trips, literal(AUTO, String)), else_=PipelineLane.pause_reason
                ),
                paused_at=case(
                    (trips, literal(now, DateTime(timezone=True))),
                    else_=PipelineLane.paused_at,
                ),
            )
            .returning(PipelineLane.paused)
        )).scalar_one_or_none()
        await session.commit()
    return bool(paused)


async def record_error(sessionmaker: Sessionmaker, lane: str, error: str) -> None:
    """A note for /pipeline that is not a failure streak (e.g. a crash before exit)."""
    await _update_lane(sessionmaker, lane, last_error=error, last_error_at=utcnow())


async def pause(sessionmaker: Sessionmaker, lane: str) -> None:
    await _update_lane(
        sessionmaker, lane, paused=True, pause_reason=MANUAL, paused_at=utcnow()
    )


_RESUMED = dict(
    paused=False, pause_reason=None, paused_at=None, consecutive_failures=0, resume_at=None
)


async def resume(sessionmaker: Sessionmaker, lane: str) -> None:
    """Clears the pause and the streak; last_error stays as a record of what happened."""
    await _update_lane(sessionmaker, lane, **_RESUMED)


async def record_usage(sessionmaker: Sessionmaker, lane: str, usage: UsageSnapshot) -> None:
    await _update_lane(
        sessionmaker, lane, usage={**usage.to_json(), "at": utcnow().isoformat()}
    )


async def pause_for_limit(
    sessionmaker: Sessionmaker, lane: str, resume_at: datetime, reason: str
) -> None:
    """Pause until the Claude usage window resets. One UPDATE: slots finishing together
    can each call this, and the lane keeps the LATER resume_at (resuming earlier would
    only trip again). Never overrides a manual pause."""
    now = utcnow()
    at = literal(resume_at, DateTime(timezone=True))
    already = and_(PipelineLane.paused.is_(True), PipelineLane.pause_reason == LIMIT)
    async with sessionmaker() as session:
        await session.execute(
            update(PipelineLane)
            .where(
                PipelineLane.lane == lane,
                PipelineLane.pause_reason.is_distinct_from(MANUAL),
            )
            .values(
                paused=True,
                pause_reason=LIMIT,
                paused_at=case((already, PipelineLane.paused_at), else_=now),
                resume_at=case(
                    (already, func.greatest(func.coalesce(PipelineLane.resume_at, at), at)),
                    else_=at,
                ),
                last_error=reason,
                last_error_at=now,
            )
        )
        await session.commit()


async def resume_if_due(sessionmaker: Sessionmaker, lane: str, now: datetime) -> bool:
    """Lift a "limit" pause whose resume_at has passed; returns whether it did. Manual
    and failure-streak pauses are never lifted here. A limit pause with no resume_at
    counts as due, so it can't wedge the lane."""
    async with sessionmaker() as session:
        resumed = (await session.execute(
            update(PipelineLane)
            .where(
                PipelineLane.lane == lane,
                PipelineLane.pause_reason == LIMIT,
                or_(PipelineLane.resume_at.is_(None), PipelineLane.resume_at <= now),
            )
            .values(**_RESUMED)
            .returning(PipelineLane.lane)
        )).scalar_one_or_none()
        await session.commit()
    return resumed is not None
