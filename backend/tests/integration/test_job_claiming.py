"""The api enqueues a job row; the worker claims it. Claiming must be exclusive, and
orphan recovery must never kill a job that no worker has picked up yet."""
from sqlalchemy import select

from app.models import Job, JobStatus, utcnow
from app.pipeline import jobs


async def test_claim_returns_the_job_and_stamps_claimed_at(sessionmaker):
    async with sessionmaker() as session:
        job, created = await jobs.enqueue_job(
            session, kind="load_older", params={"channel_id": "UC9"}
        )
        assert created
        job_id = job.id

    claimed = await jobs.claim_next_job(sessionmaker)
    assert claimed == (job_id, "load_older", {"channel_id": "UC9"})

    async with sessionmaker() as session:
        row = await session.get(Job, job_id)
        assert row.claimed_at is not None


async def test_a_claimed_job_is_not_handed_out_twice(sessionmaker):
    async with sessionmaker() as session:
        await jobs.enqueue_job(session, kind="analyze", params=None)

    first = await jobs.claim_next_job(sessionmaker)
    second = await jobs.claim_next_job(sessionmaker)
    assert first is not None
    assert second is None


async def test_orphan_recovery_spares_unclaimed_jobs(sessionmaker):
    """An api-enqueued job waiting for a worker must survive worker startup."""
    async with sessionmaker() as session:
        session.add(Job(
            status=JobStatus.running, kind="analyze",
            progress={}, claimed_at=utcnow(),
        ))          # a worker died holding this one
        session.add(Job(status=JobStatus.running, kind="analyze", progress={}))
        await session.commit()

    cleaned = await jobs.fail_orphan_jobs(sessionmaker)
    assert cleaned == 1

    async with sessionmaker() as session:
        rows = list((await session.execute(
            select(Job).order_by(Job.id)
        )).scalars().all())
    assert rows[0].status is JobStatus.failed
    assert rows[1].status is JobStatus.running      # still waiting to be claimed
