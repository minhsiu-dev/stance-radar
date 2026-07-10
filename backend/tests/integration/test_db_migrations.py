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
            "discovered", "pending", "analyzed",
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
