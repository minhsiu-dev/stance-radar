from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import delete, func, select

from app.models import Channel, Job, JobStatus, Mention, PortfolioTransaction, PriceBar, PriceCoverage, Stance, TransactionSide, Video, VideoStance, VideoStatus, utcnow


def _channel() -> Channel:
    return Channel(
        id="UCbta0n8i6Rljh0obO7HzG9A",
        title="測試頻道",
        thumbnail_url="https://example.com/t.jpg",
        uploads_playlist_id="UUbta0n8i6Rljh0obO7HzG9A",
    )


def _video(channel_id: str) -> Video:
    return Video(
        id="dQw4w9WgXcQ",
        channel_id=channel_id,
        title="AAPL 分析",
        published_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        thumbnail_url="https://example.com/v.jpg",
    )


async def test_roundtrip_all_tables(session):
    ch = _channel()
    session.add(ch)
    video = _video(ch.id)
    session.add(video)
    session.add(Mention(
        video_id=video.id, ticker="AAPL", start_seconds=12.5,
        quote="我覺得蘋果可以買", stance=Stance.buy, reasoning="明確看多",
    ))
    session.add(VideoStance(
        video_id=video.id, ticker="AAPL", stance=Stance.buy, summary="整體看多",
    ))
    session.add(Job(status=JobStatus.running, progress={"stage": "listing"}))
    await session.commit()

    loaded = (await session.execute(select(Video))).scalar_one()
    assert loaded.status == VideoStatus.pending  # default value
    assert loaded.duration_seconds is None
    mention = (await session.execute(select(Mention))).scalar_one()
    assert mention.stance == Stance.buy
    job = (await session.execute(select(Job))).scalar_one()
    assert job.progress == {"stage": "listing"}


async def test_delete_channel_cascades(session):
    ch = _channel()
    session.add(ch)
    video = _video(ch.id)
    session.add(video)
    session.add(Mention(
        video_id=video.id, ticker="AAPL", start_seconds=1.0,
        quote="q", stance=Stance.neutral, reasoning="r",
    ))
    session.add(VideoStance(
        video_id=video.id, ticker="AAPL", stance=Stance.neutral, summary="s",
    ))
    await session.commit()

    await session.execute(delete(Channel).where(Channel.id == ch.id))
    await session.commit()

    for model in (Video, Mention, VideoStance):
        count = (await session.execute(select(func.count()).select_from(model))).scalar_one()
        assert count == 0, f"{model.__name__} should be removed by DB-level cascade"


async def test_mention_persists_context_columns(sessionmaker):
    from sqlalchemy import select
    from app.models import Channel, Mention, Stance, Video, VideoStatus, utcnow

    async with sessionmaker() as s:
        s.add(Channel(id="c1", title="ch", thumbnail_url="", uploads_playlist_id="UU"))
        s.add(Video(
            id="v1", channel_id="c1", title="t",
            published_at=utcnow(), thumbnail_url="", duration_seconds=60,
            status=VideoStatus.analyzed,
        ))
        s.add(Mention(
            video_id="v1", ticker="AAPL", start_seconds=10.0,
            quote="蘋果這季很強", stance=Stance.buy, reasoning="財報優於預期",
            context_before="先講一下個股", context_after="總之我會繼續持有",
        ))
        await s.commit()
    async with sessionmaker() as s:
        row = (await s.execute(select(Mention))).scalar_one()
        assert row.context_before == "先講一下個股"
        assert row.context_after == "總之我會繼續持有"


async def test_price_bar_roundtrip(session):
    session.add(PriceBar(
        ticker="AAPL", date=date(2026, 6, 1),
        open=1.0, high=2.0, low=0.5, close=1.5, volume=100,
    ))
    session.add(PriceCoverage(
        ticker="AAPL", start_date=date(2025, 1, 1), end_date=date(2026, 6, 1),
        last_synced_at=utcnow(),
    ))
    await session.commit()
    bar = await session.get(PriceBar, ("AAPL", date(2026, 6, 1)))
    assert bar is not None and bar.close == 1.5
    cov = await session.get(PriceCoverage, "AAPL")
    assert cov.end_date == date(2026, 6, 1)


async def test_portfolio_transaction_roundtrip(session):
    tx = PortfolioTransaction(
        ticker="AAPL", side=TransactionSide.buy,
        shares=Decimal("10.5"), price=Decimal("123.45"),
        executed_on=date(2026, 6, 1),
    )
    session.add(tx)
    await session.commit()
    loaded = await session.get(PortfolioTransaction, tx.id)
    assert loaded.shares == Decimal("10.5")
    assert loaded.side is TransactionSide.buy
    assert loaded.note is None
    assert loaded.created_at.tzinfo is not None
