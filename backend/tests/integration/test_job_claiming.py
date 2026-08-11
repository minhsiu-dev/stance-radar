"""The api enqueues a job row; the worker claims it. Claiming must be exclusive, and
orphan recovery must never kill a job that no worker has picked up yet -- but it must
still catch a job that crashed while running in-process (RefreshRunner.start(), which
every api route and _continue_if_pending use today): claimed_at is the single source of
truth for "is anyone actually executing this row right now", not "was this row created
by a worker's claim"."""
import asyncio

from sqlalchemy import select

from app.analysis.llm import FakeLLMClient
from app.analysis.tickers import TickerValidator
from app.config import Settings
from app.market.client import FakeMarketClient
from app.models import Channel, Job, JobKind, JobStatus, utcnow
from app.pipeline import jobs
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.transcripts.client import FakeTranscriptClient
from app.youtube.client import FakeYouTubeClient


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


async def test_a_claimed_job_is_not_returned_by_a_second_sequential_claim(sessionmaker):
    """Sequential-claim idempotency only: the two claim_next_job calls never overlap, so
    the second returns None simply because the first already committed claimed_at first.
    This does NOT exercise SKIP LOCKED -- see
    test_claim_skips_a_row_a_concurrent_transaction_is_holding for a test that actually
    would fail if `.with_for_update(skip_locked=True)` were dropped from claim_next_job."""
    async with sessionmaker() as session:
        await jobs.enqueue_job(session, kind="analyze", params=None)

    first = await jobs.claim_next_job(sessionmaker)
    second = await jobs.claim_next_job(sessionmaker)
    assert first is not None
    assert second is None


async def test_claim_skips_a_row_a_concurrent_transaction_is_holding(sessionmaker):
    """Real SKIP LOCKED coverage: while a concurrent transaction holds the row FOR
    UPDATE (uncommitted), claim_next_job must skip it rather than block behind it or
    hand it out. wait_for turns "blocks forever instead of skipping" into a fast,
    deterministic test failure instead of hanging the suite if
    `.with_for_update(skip_locked=True)` is ever dropped from claim_next_job."""
    async with sessionmaker() as session:
        job, created = await jobs.enqueue_job(session, kind="analyze", params=None)
        assert created
        job_id = job.id

    holder = sessionmaker()
    await holder.execute(select(Job).where(Job.id == job_id).with_for_update())
    try:
        result = await asyncio.wait_for(jobs.claim_next_job(sessionmaker), timeout=5)
        assert result is None
    finally:
        await holder.rollback()
        await holder.close()

    # once the holder's transaction ends, the row is claimable again
    assert await jobs.claim_next_job(sessionmaker) is not None


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


def _make_runner(sessionmaker, *, youtube=None) -> RefreshRunner:
    return RefreshRunner(RefreshDeps(
        sessionmaker=sessionmaker,
        youtube=youtube or FakeYouTubeClient(),
        transcripts=FakeTranscriptClient(),
        llm=FakeLLMClient(),
        ticker_validator=TickerValidator(FakeMarketClient()),
        settings=Settings(),
    ))


async def _seed_channel_with_a_gated_discover(sessionmaker):
    """A channel plus a youtube fake whose list_new_uploads blocks on an Event, so a
    discover job started against it stays `running` until the caller releases the gate.
    Needed to observe job state mid-run deterministically instead of racing a job that
    (with fake adapters and no seeded videos) would otherwise finish almost instantly."""
    async with sessionmaker() as session:
        session.add(Channel(
            id="UC1", title="c", thumbnail_url="", uploads_playlist_id="UU1",
        ))
        await session.commit()

    youtube = FakeYouTubeClient()
    gate = asyncio.Event()
    original = youtube.list_new_uploads

    async def gated(*args, **kwargs):
        await gate.wait()
        return await original(*args, **kwargs)

    youtube.list_new_uploads = gated
    return youtube, gate


async def test_a_start_created_job_is_not_claimable_by_a_worker(sessionmaker):
    """RefreshRunner.start() -- used by every api route today, and by
    _continue_if_pending -- executes the job in-process immediately. It must not leave
    claimed_at NULL while doing so, or a separate worker's claim_next_job() could pick up
    and run the very same job a second time, concurrently with the in-process task."""
    youtube, gate = await _seed_channel_with_a_gated_discover(sessionmaker)
    runner = _make_runner(sessionmaker, youtube=youtube)
    try:
        job_id, created = await runner.start(JobKind.discover)
        assert created
        assert await jobs.claim_next_job(sessionmaker) is None
    finally:
        gate.set()
        await runner.current_task


async def test_a_start_created_job_is_cleaned_by_orphan_recovery(sessionmaker):
    """Simulates the api process dying mid-job: start() runs the job in-process, so if
    that process crashes before the job finishes, orphan recovery at the next startup
    must still catch it -- it was cleaned before claim_next_job existed (fail_orphan_jobs
    used to match on status alone); this asserts that guarantee survived the switch to
    also requiring claimed_at."""
    youtube, gate = await _seed_channel_with_a_gated_discover(sessionmaker)
    runner = _make_runner(sessionmaker, youtube=youtube)
    try:
        job_id, created = await runner.start(JobKind.discover)
        assert created

        cleaned = await jobs.fail_orphan_jobs(sessionmaker)
        assert cleaned == 1

        async with sessionmaker() as session:
            row = await session.get(Job, job_id)
            assert row.status is JobStatus.failed
    finally:
        gate.set()
        await runner.current_task


async def test_enqueue_created_job_is_claimable_by_a_worker(sessionmaker):
    """The other half of the invariant: RefreshRunner.enqueue() (no in-process
    execution) must leave the row genuinely unclaimed for a worker to pick up."""
    runner = _make_runner(sessionmaker)
    job_id, created = await runner.enqueue(JobKind.discover)
    assert created
    assert await jobs.claim_next_job(sessionmaker) == (job_id, "discover", {})
