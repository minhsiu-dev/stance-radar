from sqlalchemy import func, select, update

from app.analysis.llm import AnalysisError, FakeLLMClient
from app.analysis.tickers import TickerValidator
from app.analysis.types import AnalysisResult, MentionResult, StanceResult
from app.config import Settings
from app.market.client import FakeMarketClient
from app.models import (
    Channel, Job, JobKind, JobStatus, Mention, Video, VideoStance, VideoStatus,
)
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.transcripts.client import FakeTranscriptClient
from app.youtube.client import FakeYouTubeClient, QuotaExceededError


def make_settings(**overrides) -> Settings:
    defaults = dict(
        youtube_api_key="x",
        backfill_limit=30, analysis_concurrency=2, _env_file=None,
    )
    return Settings(**{**defaults, **overrides})


def make_runner(sessionmaker, *, llm=None, youtube=None, settings=None) -> RefreshRunner:
    return RefreshRunner(RefreshDeps(
        sessionmaker=sessionmaker,
        youtube=youtube or FakeYouTubeClient(),
        transcripts=FakeTranscriptClient(),
        llm=llm or FakeLLMClient(),
        ticker_validator=TickerValidator(FakeMarketClient()),
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


async def select_all_for_analysis(sessionmaker) -> None:
    """Simulate the user selecting all on the picker page: discovered -> pending."""
    async with sessionmaker() as s:
        await s.execute(
            update(Video)
            .where(Video.status == VideoStatus.discovered)
            .values(status=VideoStatus.pending)
        )
        await s.commit()


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


async def test_happy_path_two_phase(session, sessionmaker):
    await seed_channels(session)
    runner = make_runner(sessionmaker)
    await run_job(runner, JobKind.discover)
    await select_all_for_analysis(sessionmaker)
    job_id = await run_job(runner, JobKind.analyze)

    job = await session.get(Job, job_id)
    assert job.status == JobStatus.done
    assert job.kind == "analyze"
    assert job.progress["videos_total"] == 6

    videos = (await session.execute(select(Video))).scalars().all()
    by_status = {}
    for v in videos:
        by_status.setdefault(v.status, []).append(v.id)
    assert sorted(by_status[VideoStatus.no_transcript]) == ["beta_vid_1"]
    assert len(by_status[VideoStatus.analyzed]) == 5

    assert await count(session, Mention) == 5        # 1+1+0+1+2
    assert await count(session, VideoStance) == 5
    analyzed = await session.get(Video, "alpha_vid_3")
    assert analyzed.transcript_language == "zh-TW"
    assert analyzed.duration_seconds == 600


async def test_analyze_only_processes_pending(session, sessionmaker):
    await seed_channels(session)
    runner = make_runner(sessionmaker)
    await run_job(runner, JobKind.discover)
    async with sessionmaker() as s:
        video = await s.get(Video, "alpha_vid_3")
        video.status = VideoStatus.pending
        await s.commit()

    job_id = await run_job(runner, JobKind.analyze)
    job = await session.get(Job, job_id)
    assert job.progress["videos_total"] == 1
    assert (await session.get(Video, "alpha_vid_3")).status == VideoStatus.analyzed
    assert (await session.get(Video, "alpha_vid_2")).status == VideoStatus.discovered


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


async def test_failed_video_retried_after_reselect_without_duplicates(
    session, sessionmaker
):
    await seed_channels(session)

    class FlakyLLM(FakeLLMClient):
        async def analyze(self, *, video_id, video_title, transcript):
            if video_id == "alpha_vid_3":
                raise AnalysisError("temporary failure")
            return await super().analyze(
                video_id=video_id, video_title=video_title, transcript=transcript
            )

    runner = make_runner(sessionmaker, llm=FlakyLLM())
    await run_job(runner, JobKind.discover)
    await select_all_for_analysis(sessionmaker)
    await run_job(runner, JobKind.analyze)
    video = await session.get(Video, "alpha_vid_3")
    assert video.status == VideoStatus.failed
    assert "temporary failure" in video.error_message

    # retry = the user sets the failed video back to pending (the analyze endpoint's behavior)
    async with sessionmaker() as s:
        retry = await s.get(Video, "alpha_vid_3")
        retry.status = VideoStatus.pending
        retry.error_message = None
        await s.commit()
    await run_job(make_runner(sessionmaker), JobKind.analyze)
    await session.refresh(video)
    assert video.status == VideoStatus.analyzed
    mention_count = (await session.execute(
        select(func.count()).select_from(Mention)
        .where(Mention.video_id == "alpha_vid_3")
    )).scalar_one()
    assert mention_count == 1  # rerun does not duplicate


async def test_leftover_pending_swept_by_next_analyze(session, sessionmaker):
    """A pending video left over from a previous interruption must be picked up by the next analyze job (resume semantics)."""
    await seed_channels(session)
    runner = make_runner(sessionmaker)
    await run_job(runner, JobKind.discover)
    async with sessionmaker() as s:
        video = await s.get(Video, "beta_vid_3")
        video.status = VideoStatus.pending
        await s.commit()

    await run_job(runner, JobKind.analyze)
    assert (await session.get(Video, "beta_vid_3")).status == VideoStatus.analyzed


async def test_unknown_ticker_mentions_dropped(session, sessionmaker):
    await seed_channels(session)

    class UnknownTickerLLM(FakeLLMClient):
        async def analyze(self, *, video_id, video_title, transcript):
            if video_id == "alpha_vid_3":
                return AnalysisResult(
                    mentions=(MentionResult("ZZZZ", 1.0, "q", "buy", "r"),),
                    stances=(StanceResult("ZZZZ", "buy", "s"),),
                )
            return AnalysisResult.empty()

    runner = make_runner(sessionmaker, llm=UnknownTickerLLM())
    await run_job(runner, JobKind.discover)
    await select_all_for_analysis(sessionmaker)
    await run_job(runner, JobKind.analyze)
    video = await session.get(Video, "alpha_vid_3")
    assert video.status == VideoStatus.analyzed
    assert await count(session, Mention) == 0
    assert await count(session, VideoStance) == 0


async def test_concurrent_start_returns_same_job(session, sessionmaker):
    await seed_channels(session)
    runner = make_runner(sessionmaker)
    job_id, created = await runner.start(JobKind.discover)
    job_id2, created2 = await runner.start(JobKind.analyze)
    assert created is True and created2 is False
    assert job_id == job_id2  # discover and analyze share a single job lock
    await runner.current_task


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


async def test_refresh_pipeline_populates_mention_context(session, sessionmaker):
    await seed_channels(session)
    runner = make_runner(sessionmaker)
    await run_job(runner, JobKind.discover)
    await select_all_for_analysis(sessionmaker)
    await run_job(runner, JobKind.analyze)

    async with sessionmaker() as s:
        mentions = (await s.execute(
            select(Mention).where(Mention.video_id == "alpha_vid_3")
        )).scalars().all()
    assert mentions, "expected at least one mention for alpha_vid_3"
    aapl = next(m for m in mentions if m.ticker == "AAPL")
    # new format: excerpt is a single composed passage around the anchor (12.5s), including the anchor itself and its neighboring sentences
    assert aapl.excerpt == "今天來看蘋果的財報 蘋果這季財報很強,我會買 以上是今天的內容"
    assert aapl.context_before is None
    assert aapl.context_after is None
