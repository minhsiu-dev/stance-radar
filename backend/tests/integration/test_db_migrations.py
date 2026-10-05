from sqlalchemy import text

from app.db_migrations import run_startup_migrations


async def test_startup_migrations_idempotent(engine):
    # Running twice must not raise (all statements must be idempotent)
    await run_startup_migrations(engine)
    await run_startup_migrations(engine)

    async with engine.connect() as conn:
        labels = set((await conn.execute(text(
            "SELECT e.enumlabel FROM pg_enum e"
            " JOIN pg_type t ON t.oid = e.enumtypid"
            " WHERE t.typname = 'video_status'"
        ))).scalars().all())
        assert {
            "discovered", "pending", "transcribed", "analyzed",
            "no_transcript", "failed", "skipped",
        } <= labels

        kind_col = (await conn.execute(text(
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_name = 'jobs' AND column_name = 'kind'"
        ))).scalar_one_or_none()
        assert kind_col == "kind"


async def test_video_stances_is_conditional_backfilled_from_mentions(engine, sessionmaker):
    from datetime import datetime, timezone

    from app.models import (
        Channel, Mention, Stance, Video, VideoStance, VideoStatus,
    )

    async with sessionmaker() as s:
        s.add(Channel(id="ch", title="c", thumbnail_url="", uploads_playlist_id="UU"))
        s.add(Video(
            id="v", channel_id="ch", title="t",
            published_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
            thumbnail_url="", duration_seconds=60, status=VideoStatus.analyzed,
        ))
        # AMD: only sell mention is conditional -> overall backfilled TRUE
        s.add(Mention(
            video_id="v", ticker="AMD", start_seconds=1.0, quote="q",
            stance=Stance.sell, reasoning="r", is_conditional=True,
        ))
        s.add(VideoStance(video_id="v", ticker="AMD", stance=Stance.sell, summary="s"))
        # NVDA: firm buy mention -> overall stays NULL (not conditional)
        s.add(Mention(
            video_id="v", ticker="NVDA", start_seconds=2.0, quote="q",
            stance=Stance.buy, reasoning="r", is_conditional=False,
        ))
        s.add(VideoStance(video_id="v", ticker="NVDA", stance=Stance.buy, summary="s"))
        await s.commit()

    await run_startup_migrations(engine)

    async with sessionmaker() as s:
        amd = await s.get(VideoStance, ("v", "AMD"))
        nvda = await s.get(VideoStance, ("v", "NVDA"))
        assert amd.is_conditional is True
        assert nvda.is_conditional is None


async def test_backfill_stays_null_when_a_matching_stance_mention_is_firm(engine, sessionmaker):
    from datetime import datetime, timezone

    from app.models import (
        Channel, Mention, Stance, Video, VideoStance, VideoStatus,
    )

    async with sessionmaker() as s:
        s.add(Channel(id="ch2", title="c", thumbnail_url="", uploads_playlist_id="UU2"))
        s.add(Video(
            id="v2", channel_id="ch2", title="t",
            published_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
            thumbnail_url="", duration_seconds=60, status=VideoStatus.analyzed,
        ))
        # two sell mentions for the same (video, ticker): one conditional, one firm
        s.add(Mention(
            video_id="v2", ticker="AMD", start_seconds=1.0, quote="q",
            stance=Stance.sell, reasoning="r", is_conditional=True,
        ))
        s.add(Mention(
            video_id="v2", ticker="AMD", start_seconds=2.0, quote="q",
            stance=Stance.sell, reasoning="r", is_conditional=False,
        ))
        s.add(VideoStance(video_id="v2", ticker="AMD", stance=Stance.sell, summary="s"))
        await s.commit()

    await run_startup_migrations(engine)

    async with sessionmaker() as s:
        vs = await s.get(VideoStance, ("v2", "AMD"))
        assert vs.is_conditional is None  # a firm matching-stance mention blocks the backfill


async def test_legacy_attempt_backfill_lands_on_the_stage_the_video_died_in(
    engine, sessionmaker
):
    from datetime import datetime, timezone

    from app.models import Channel, Video, VideoStatus

    stored = {"language": "en", "segments": [{"start": 0.0, "text": "hi"}]}
    async with sessionmaker() as s:
        s.add(Channel(id="ch3", title="c", thumbnail_url="", uploads_playlist_id="UU3"))
        # Failed before attempts were counted, no transcript stored -> a transcript-stage failure
        s.add(Video(
            id="v-failed", channel_id="ch3", title="t",
            published_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
            thumbnail_url="", duration_seconds=60,
            status=VideoStatus.failed, error_message="claude exited -11",
        ))
        # Failed before attempts were counted, transcript stored -> an analysis-stage failure
        s.add(Video(
            id="v-crashed", channel_id="ch3", title="t",
            published_at=datetime(2026, 6, 2, tzinfo=timezone.utc),
            thumbnail_url="", duration_seconds=60, transcript=stored,
            status=VideoStatus.failed, error_message="claude exited -11",
        ))
        # never analyzed: no error_message -> stays 0 everywhere
        s.add(Video(
            id="v-fresh", channel_id="ch3", title="t",
            published_at=datetime(2026, 6, 3, tzinfo=timezone.utc),
            thumbnail_url="", duration_seconds=60,
            status=VideoStatus.discovered,
        ))
        await s.commit()

    await run_startup_migrations(engine)

    async with sessionmaker() as s:
        failed = await s.get(Video, "v-failed")
        crashed = await s.get(Video, "v-crashed")
        fresh = await s.get(Video, "v-fresh")
        assert (failed.transcript_attempts, failed.analysis_attempts) == (1, 0)
        assert (crashed.transcript_attempts, crashed.analysis_attempts) == (0, 1)
        assert (fresh.transcript_attempts, fresh.analysis_attempts) == (0, 0)
        # a real count must not be flattened back to 1 by a later startup
        failed.transcript_attempts = 7
        await s.commit()

    await run_startup_migrations(engine)

    async with sessionmaker() as s:
        failed = await s.get(Video, "v-failed")
        assert (failed.transcript_attempts, failed.analysis_attempts) == (7, 0)


async def test_two_lane_migrations_backfill_and_are_idempotent(engine, sessionmaker):
    from datetime import datetime, timezone

    from sqlalchemy import select

    from app.models import (
        Channel, Job, JobStatus, PipelineLane, Video, VideoStatus,
    )

    stored = {"language": "en", "segments": [{"start": 0.0, "text": "hi"}]}

    def vid(vid_id, day, **kw):
        return Video(
            id=vid_id, channel_id="chp", title="t",
            published_at=datetime(2026, 6, day, tzinfo=timezone.utc),
            thumbnail_url="", **kw,
        )

    async with sessionmaker() as s:
        s.add(Channel(id="chp", title="c", thumbnail_url="", uploads_playlist_id="UUp"))
        # IP-blocked twelve times under the old combined counter
        s.add(vid("blocked", 1, status=VideoStatus.failed,
                  error_message="IpBlocked", analysis_attempts=12))
        # crashed three times in the LLM with the transcript already stored
        s.add(vid("crashed", 2, status=VideoStatus.failed, transcript=stored,
                  error_message="claude exited -11", analysis_attempts=3))
        s.add(vid("queued-w-trans", 3, status=VideoStatus.pending,
                  transcript=stored))
        s.add(vid("queued-bare", 4, status=VideoStatus.pending))
        s.add(Job(status=JobStatus.running, kind="analyze", progress={}))
        s.add(Job(status=JobStatus.done, kind="discover", progress={}))
        await s.commit()

    await run_startup_migrations(engine)
    await run_startup_migrations(engine)  # every statement must be idempotent

    async with sessionmaker() as s:
        blocked = await s.get(Video, "blocked")
        crashed = await s.get(Video, "crashed")
        assert (blocked.transcript_attempts, blocked.analysis_attempts) == (12, 0)
        assert (crashed.transcript_attempts, crashed.analysis_attempts) == (0, 3)
        assert (await s.get(Video, "queued-w-trans")).status is VideoStatus.transcribed
        assert (await s.get(Video, "queued-bare")).status is VideoStatus.pending

        lanes = {row.lane: row for row in (await s.execute(select(PipelineLane))).scalars()}
        assert set(lanes) == {"transcript", "analysis"}
        assert all(not row.paused and row.consecutive_failures == 0 for row in lanes.values())

        legacy, discover = (await s.execute(select(Job).order_by(Job.id))).scalars().all()
        assert legacy.status is JobStatus.failed
        assert legacy.error_message == "Superseded by pipeline lanes"
        assert legacy.finished_at is not None
        assert discover.status is JobStatus.done
