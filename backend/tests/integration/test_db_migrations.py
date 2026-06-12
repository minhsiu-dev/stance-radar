from sqlalchemy import text

from app.db_migrations import run_startup_migrations


async def test_startup_migrations_idempotent(engine):
    # 跑兩次都不能丟錯(全部語句必須冪等)
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
