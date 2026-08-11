from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Job, JobStatus, utcnow


async def get_running_job(session: AsyncSession) -> Job | None:
    result = await session.execute(select(Job).where(Job.status == JobStatus.running))
    return result.scalars().first()


async def enqueue_job(
    session: AsyncSession, kind: str = "discover", params: dict | None = None
) -> tuple[Job, bool]:
    """Return (job, created). If a job is already running, return it with created=False.

    The row is created as `running` (not a new `queued` status) so the frontend never sees
    a status it doesn't know; `claimed_at IS NULL` is what marks it as not-yet-picked-up.
    """
    existing = await get_running_job(session)
    if existing is not None:
        return existing, False
    job = Job(
        status=JobStatus.running, kind=kind, params=params,
        progress={"stage": "starting"},
    )
    session.add(job)
    await session.commit()
    return job, True


async def claim_next_job(
    sessionmaker: async_sessionmaker[AsyncSession],
) -> tuple[int, str, dict] | None:
    """Claim the oldest unclaimed running job. Returns (job_id, kind, params) or None.

    SKIP LOCKED keeps this correct if a second worker is ever added.
    """
    async with sessionmaker() as session:
        row = (await session.execute(
            select(Job)
            .where(Job.status == JobStatus.running, Job.claimed_at.is_(None))
            .order_by(Job.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )).scalars().first()
        if row is None:
            return None
        row.claimed_at = utcnow()
        claimed = (row.id, row.kind, dict(row.params or {}))
        await session.commit()
    return claimed


async def update_progress(
    sessionmaker: async_sessionmaker[AsyncSession], job_id: int, progress: dict
) -> None:
    async with sessionmaker() as session:
        await session.execute(
            update(Job).where(Job.id == job_id).values(progress=progress)
        )
        await session.commit()


async def finish_job(
    sessionmaker: async_sessionmaker[AsyncSession],
    job_id: int,
    error: str | None = None,
) -> None:
    async with sessionmaker() as session:
        await session.execute(
            update(Job)
            .where(Job.id == job_id)
            .values(
                status=JobStatus.failed if error else JobStatus.done,
                finished_at=utcnow(),
                error_message=error,
            )
        )
        await session.commit()


async def fail_orphan_jobs(sessionmaker: async_sessionmaker[AsyncSession]) -> int:
    """On worker restart, mark interrupted claimed jobs as failed. Returns the number cleaned up.

    Unclaimed jobs are left alone: they are enqueued work still waiting for a worker.
    """
    async with sessionmaker() as session:
        result = await session.execute(
            update(Job)
            .where(Job.status == JobStatus.running, Job.claimed_at.is_not(None))
            .values(
                status=JobStatus.failed,
                finished_at=utcnow(),
                error_message="Server restarted, job interrupted; please trigger update again",
            )
        )
        await session.commit()
        return result.rowcount
