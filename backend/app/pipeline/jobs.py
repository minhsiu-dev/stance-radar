from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Job, JobStatus, utcnow


async def get_running_job(session: AsyncSession) -> Job | None:
    result = await session.execute(select(Job).where(Job.status == JobStatus.running))
    return result.scalars().first()


async def enqueue_job(
    session: AsyncSession, kind: str = "discover", params: dict | None = None,
    claimed: bool = False,
) -> tuple[Job, bool]:
    """Return (job, created). If a job is already running, return it with created=False.

    The row is created as `running` (not a new `queued` status) so the frontend never sees
    a status it doesn't know. claimed_at is the single source of truth for "is someone
    actually executing this row right now" -- not "was it created by a worker's claim":
    pass claimed=True when the caller is about to run the job in-process immediately
    (RefreshRunner.start(), used by _continue_if_pending and by AutoRefreshScheduler --
    both already running inside the worker process), so the row is never `running` with
    `claimed_at IS NULL` while genuinely in flight. Getting this wrong bites twice:
    fail_orphan_jobs would ignore a crash mid-run because it only matches claimed_at IS
    NOT NULL, and a separate worker's claim_next_job() (same claimed_at IS NULL filter)
    could pick up and re-run the same job concurrently. Leave claimed=False (the
    default) when creating a row purely for a worker to claim later -- every api route
    does this via RefreshRunner.enqueue(), since the api process itself no longer runs
    jobs at all.

    Before the worker split, every caller of this function lived in one process and was
    serialized by RefreshRunner._start_lock (an asyncio.Lock -- process-local). Now the
    api's enqueue() and the worker's start() run in different processes with no shared
    lock, so a plain READ COMMITTED check-then-insert has a race window where both could
    read "no running job" and each insert one, breaking the single-running-job invariant
    (get_running_job has no ordering, so which one wins is arbitrary, and the worker could
    end up running two analyze jobs concurrently against the same pending set). A
    transaction-scoped advisory lock closes that window across processes without any
    schema change; it is released automatically on commit OR rollback, so the early
    return below (no commit) still releases it.
    """
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('stance_radar_jobs'))")
    )
    existing = await get_running_job(session)
    if existing is not None:
        return existing, False
    job = Job(
        status=JobStatus.running, kind=kind, params=params,
        progress={"stage": "starting"},
        claimed_at=utcnow() if claimed else None,
    )
    session.add(job)
    await session.commit()
    return job, True


async def claim_next_job(
    sessionmaker: async_sessionmaker[AsyncSession],
) -> tuple[int, str, dict] | None:
    """Claim the oldest unclaimed running job. Returns (job_id, kind, params) or None.

    SKIP LOCKED only prevents two workers from claiming the SAME row concurrently --
    it is not an invitation to run a second worker. Running two is not supported today:
    fail_orphan_jobs() (called on every worker startup) fails *any* claimed running row
    regardless of which worker claimed it, so a second worker starting up would kill the
    first worker's in-flight job.
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
