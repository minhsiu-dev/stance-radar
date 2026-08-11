import asyncio

from sqlalchemy import select

from app.models import Job, JobStatus, utcnow
from app.pipeline import jobs


async def test_enqueue_job_creates_running_job(session):
    job, created = await jobs.enqueue_job(session)
    assert created is True
    assert job.status == JobStatus.running
    assert job.kind == "discover"  # default kind


async def test_enqueue_job_with_kind(session):
    job, _ = await jobs.enqueue_job(session, kind="analyze")
    assert job.kind == "analyze"


async def test_enqueue_job_returns_existing_running_job(session):
    first, _ = await jobs.enqueue_job(session)
    second, created = await jobs.enqueue_job(session)
    assert created is False
    assert second.id == first.id


async def test_update_progress_persists(session, sessionmaker):
    job, _ = await jobs.enqueue_job(session)
    await jobs.update_progress(sessionmaker, job.id, {"stage": "analyzing", "videos_done": 3})
    await session.refresh(job)
    assert job.progress == {"stage": "analyzing", "videos_done": 3}


async def test_finish_job_done_and_failed(session, sessionmaker):
    job, _ = await jobs.enqueue_job(session)
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


async def test_enqueue_job_advisory_lock_serializes_across_connections(
    sessionmaker, monkeypatch
):
    """The bug this guards against only shows up across two separate DB connections
    (the api's connection vs. the worker's), standing in for the two separate processes
    that used to be serialized by RefreshRunner._start_lock (process-local, so useless
    across the worker split). A plain asyncio.gather race is not deterministic enough to
    prove anything either way -- both calls might happen to interleave without ever
    hitting the race window. Instead this forces the interleaving: connection A is
    paused (via a patched get_running_job) right after it would have acquired the
    advisory lock but before it checks/inserts, then connection B is started and given
    every opportunity to race in. If the fix's pg_advisory_xact_lock call is doing its
    job, B's own attempt to acquire that lock blocks at the Postgres level -- it must
    never even reach get_running_job -- until A commits and releases it.

    Reverting the `pg_advisory_xact_lock` line in enqueue_job makes this test fail
    (confirmed manually): B reaches get_running_job immediately instead of blocking,
    because nothing serializes the two connections anymore.
    """
    a_holds_lock = asyncio.Event()
    release_a = asyncio.Event()
    b_reached_check = asyncio.Event()
    call_count = 0
    original_get_running_job = jobs.get_running_job

    async def patched_get_running_job(session):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # A: signal that it has (deterministically) already made it past the
            # advisory-lock acquisition and is now paused before its check-then-insert.
            a_holds_lock.set()
            await release_a.wait()
        else:
            # Only reachable once A has committed and released the lock -- if this
            # fires before that, the lock isn't actually serializing the two.
            b_reached_check.set()
        return await original_get_running_job(session)

    monkeypatch.setattr(jobs, "get_running_job", patched_get_running_job)

    async def run(sm) -> tuple[Job, bool]:
        async with sm() as session:
            return await jobs.enqueue_job(session, kind="discover")

    task_a = asyncio.create_task(run(sessionmaker))
    await a_holds_lock.wait()  # A now holds the advisory lock, paused mid check-then-insert

    task_b = asyncio.create_task(run(sessionmaker))
    # Give B every opportunity to race in before we release A.
    await asyncio.sleep(0.2)
    assert not b_reached_check.is_set(), (
        "B must still be blocked acquiring the advisory lock while A holds it "
        "uncommitted -- the check-then-insert is not actually serialized"
    )

    release_a.set()
    job_a, created_a = await task_a
    job_b, created_b = await asyncio.wait_for(task_b, timeout=5)

    assert created_a is True
    assert created_b is False, "B must see A's committed row, not insert a second one"
    assert job_b.id == job_a.id

    async with sessionmaker() as check_session:
        rows = (await check_session.execute(
            select(Job).where(Job.status == JobStatus.running)
        )).scalars().all()
    assert len(rows) == 1, "exactly one running job must exist, not two"


async def test_fail_orphan_jobs(session, sessionmaker):
    # claimed_at set: a worker was holding this one when the process died.
    session.add(Job(status=JobStatus.running, claimed_at=utcnow()))
    session.add(Job(status=JobStatus.done))
    await session.commit()
    count = await jobs.fail_orphan_jobs(sessionmaker)
    assert count == 1
    statuses = (await session.execute(select(Job.status))).scalars().all()
    assert JobStatus.running not in statuses
