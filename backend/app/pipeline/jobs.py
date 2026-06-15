from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Job, JobStatus, utcnow


async def get_running_job(session: AsyncSession) -> Job | None:
    result = await session.execute(select(Job).where(Job.status == JobStatus.running))
    return result.scalars().first()


async def start_job(session: AsyncSession, kind: str = "discover") -> tuple[Job, bool]:
    """Return (job, created). If a running job already exists, return it with created=False."""
    existing = await get_running_job(session)
    if existing is not None:
        return existing, False
    job = Job(status=JobStatus.running, kind=kind, progress={"stage": "starting"})
    session.add(job)
    await session.commit()
    return job, True


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
    """On API restart, mark interrupted running jobs as failed. Returns the number cleaned up."""
    async with sessionmaker() as session:
        result = await session.execute(
            update(Job)
            .where(Job.status == JobStatus.running)
            .values(
                status=JobStatus.failed,
                finished_at=utcnow(),
                error_message="Server restarted, job interrupted; please trigger update again",
            )
        )
        await session.commit()
        return result.rowcount
