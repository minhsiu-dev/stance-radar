from sqlalchemy import select

from app.models import Job, JobStatus
from app.pipeline import jobs


async def test_start_job_creates_running_job(session):
    job, created = await jobs.start_job(session)
    assert created is True
    assert job.status == JobStatus.running
    assert job.kind == "discover"  # 預設 kind


async def test_start_job_with_kind(session):
    job, _ = await jobs.start_job(session, kind="analyze")
    assert job.kind == "analyze"


async def test_start_job_returns_existing_running_job(session):
    first, _ = await jobs.start_job(session)
    second, created = await jobs.start_job(session)
    assert created is False
    assert second.id == first.id


async def test_update_progress_persists(session, sessionmaker):
    job, _ = await jobs.start_job(session)
    await jobs.update_progress(sessionmaker, job.id, {"stage": "analyzing", "videos_done": 3})
    await session.refresh(job)
    assert job.progress == {"stage": "analyzing", "videos_done": 3}


async def test_finish_job_done_and_failed(session, sessionmaker):
    job, _ = await jobs.start_job(session)
    await jobs.finish_job(sessionmaker, job.id)
    await session.refresh(job)
    assert job.status == JobStatus.done
    assert job.finished_at is not None

    job2 = Job(status=JobStatus.running)
    session.add(job2)
    await session.commit()
    await jobs.finish_job(sessionmaker, job2.id, error="quota 爆了")
    await session.refresh(job2)
    assert job2.status == JobStatus.failed
    assert job2.error_message == "quota 爆了"


async def test_fail_orphan_jobs(session, sessionmaker):
    session.add(Job(status=JobStatus.running))
    session.add(Job(status=JobStatus.done))
    await session.commit()
    count = await jobs.fail_orphan_jobs(sessionmaker)
    assert count == 1
    statuses = (await session.execute(select(Job.status))).scalars().all()
    assert JobStatus.running not in statuses
