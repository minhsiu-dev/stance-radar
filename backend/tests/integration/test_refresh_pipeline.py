from sqlalchemy import func, select

from app.config import Settings
from app.models import Channel, Job, JobKind, JobStatus, Mention, Video, VideoStatus
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.youtube.client import FakeYouTubeClient, QuotaExceededError


def make_settings(**overrides) -> Settings:
    defaults = dict(
        youtube_api_key="x",
        backfill_limit=30, analysis_concurrency=2, _env_file=None,
    )
    return Settings(**{**defaults, **overrides})


def make_runner(sessionmaker, *, youtube=None, settings=None) -> RefreshRunner:
    return RefreshRunner(RefreshDeps(
        sessionmaker=sessionmaker,
        youtube=youtube or FakeYouTubeClient(),
        settings=settings or make_settings(),
    ))


async def seed_channels(session) -> None:
    for info in FakeYouTubeClient.CHANNELS.values():
        session.add(Channel(
            id=info.id, title=info.title, thumbnail_url=info.thumbnail_url,
            uploads_playlist_id=info.uploads_playlist_id,
        ))
    await session.commit()


async def run_job(runner: RefreshRunner, kind: JobKind) -> int:
    job_id, created = await runner.start(kind)
    assert created is True
    await runner.current_task
    return job_id


async def count(session, model) -> int:
    return (await session.execute(select(func.count()).select_from(model))).scalar_one()


async def test_discover_creates_discovered_videos_without_analyzing(
    session, sessionmaker
):
    await seed_channels(session)
    job_id = await run_job(make_runner(sessionmaker), JobKind.discover)

    job = await session.get(Job, job_id)
    assert job.status == JobStatus.done
    assert job.kind == "discover"
    assert job.progress["discovered"] == 6

    videos = (await session.execute(select(Video))).scalars().all()
    assert len(videos) == 6
    assert {v.status for v in videos} == {VideoStatus.discovered}
    assert await count(session, Mention) == 0
    channel = await session.get(Channel, "UC_fake_alpha")
    assert channel.last_refreshed_at is not None


async def test_discover_skips_shorts(session, sessionmaker):
    await seed_channels(session)
    await run_job(make_runner(sessionmaker), JobKind.discover)
    ids = set((await session.execute(select(Video.id))).scalars().all())
    # alpha_short (45s <= 240) is skipped; the normal videos are ingested
    assert "alpha_short" not in ids
    assert "alpha_vid_3" in ids
    assert "alpha_vid_2" in ids


async def test_skipped_videos_do_not_resurrect_on_rediscover(session, sessionmaker):
    await seed_channels(session)
    runner = make_runner(sessionmaker)
    await run_job(runner, JobKind.discover)
    async with sessionmaker() as s:
        # skip the newest video (pagination stop point); rerunning discover must not resurrect or re-import it
        video = await s.get(Video, "alpha_vid_3")
        video.status = VideoStatus.skipped
        await s.commit()

    await run_job(make_runner(sessionmaker), JobKind.discover)
    assert await count(session, Video) == 6
    assert (await session.get(Video, "alpha_vid_3")).status == VideoStatus.skipped


async def test_second_discover_is_idempotent(session, sessionmaker):
    await seed_channels(session)
    await run_job(make_runner(sessionmaker), JobKind.discover)
    job_id = await run_job(make_runner(sessionmaker), JobKind.discover)

    job = await session.get(Job, job_id)
    assert job.status == JobStatus.done
    assert job.progress["discovered"] == 0
    assert await count(session, Video) == 6


async def test_backfill_limit_applies_to_new_channels(session, sessionmaker):
    await seed_channels(session)
    runner = make_runner(sessionmaker, settings=make_settings(backfill_limit=2))
    await run_job(runner, JobKind.discover)
    # newest 2 per channel are fetched; alpha's newest 2 are alpha_short (filtered) + alpha_vid_3,
    # so alpha ingests 1 and beta ingests 2 -> 3 total
    assert await count(session, Video) == 3


async def test_quota_exceeded_fails_job_with_message(session, sessionmaker):
    await seed_channels(session)

    class QuotaYouTube(FakeYouTubeClient):
        async def list_new_uploads(self, playlist_id, *, known_video_ids, limit):
            raise QuotaExceededError("YouTube API quota exhausted, retry tomorrow")

    runner = make_runner(sessionmaker, youtube=QuotaYouTube())
    job_id, _ = await runner.start(JobKind.discover)
    await runner.current_task
    job = await session.get(Job, job_id)
    assert job.status == JobStatus.failed
    assert "quota" in job.error_message


async def test_concurrent_start_returns_same_job(session, sessionmaker):
    await seed_channels(session)
    runner = make_runner(sessionmaker)
    job_id, created = await runner.start(JobKind.discover)
    job_id2, created2 = await runner.start(JobKind.load_older, channel_id="UC_fake_alpha")
    assert created is True and created2 is False
    assert job_id == job_id2  # discover and load_older share a single job slot
    await runner.current_task
