from datetime import date, datetime, timedelta, timezone

from app.market.client import Candle, FakeMarketClient
from app.market.store import PriceStore


class CountingFake(FakeMarketClient):
    def __init__(self):
        self.calls: list[tuple[tuple[str, ...], date, date]] = []

    async def get_daily_history(self, tickers, start, end):
        self.calls.append((tuple(tickers), start, end))
        return await super().get_daily_history(tickers, start, end)


class RescalingFake(CountingFake):
    """Simulate the whole series being re-adjusted after a dividend/split: from the
    second call onward all close prices are halved."""

    async def get_daily_history(self, tickers, start, end):
        out = await super().get_daily_history(tickers, start, end)
        if len(self.calls) > 1:
            out = {
                t: [
                    Candle(time=c.time, open=c.open / 2, high=c.high / 2,
                           low=c.low / 2, close=c.close / 2, volume=c.volume)
                    for c in candles
                ]
                for t, candles in out.items()
            }
        return out


async def test_first_call_fetches_and_persists(sessionmaker):
    fake = CountingFake()
    store = PriceStore(sessionmaker, fake)
    start = date.today() - timedelta(days=30)
    out = await store.get_daily(["AAPL", "VOO"], start)
    assert len(fake.calls) == 1  # both tickers fetched in a single batch
    assert len(out["AAPL"]) > 10
    assert out["AAPL"][0].time >= start.isoformat()


async def test_second_call_within_hour_hits_db_only(sessionmaker):
    fake = CountingFake()
    store = PriceStore(sessionmaker, fake)
    start = date.today() - timedelta(days=30)
    first = await store.get_daily(["AAPL"], start)
    second = await store.get_daily(["AAPL"], start)
    assert len(fake.calls) == 1  # the second call goes entirely through the DB
    assert [c.close for c in second["AAPL"]] == [c.close for c in first["AAPL"]]


async def test_leading_extension_refetches_full_span(sessionmaker):
    fake = CountingFake()
    store = PriceStore(sessionmaker, fake)
    await store.get_daily(["AAPL"], date.today() - timedelta(days=30))
    out = await store.get_daily(["AAPL"], date.today() - timedelta(days=90))
    assert len(fake.calls) == 2
    assert out["AAPL"][0].time <= (date.today() - timedelta(days=80)).isoformat()


async def test_unknown_ticker_returns_empty_and_does_not_refetch(sessionmaker):
    fake = CountingFake()
    store = PriceStore(sessionmaker, fake)
    start = date.today() - timedelta(days=30)
    assert (await store.get_daily(["ZZZZ"], start))["ZZZZ"] == []
    assert (await store.get_daily(["ZZZZ"], start))["ZZZZ"] == []
    assert len(fake.calls) == 1  # coverage remembers "queried, no data"


async def test_rescaled_series_is_wiped_and_refetched(sessionmaker):
    fake = RescalingFake()
    store = PriceStore(sessionmaker, fake)
    start = date.today() - timedelta(days=60)
    first = await store.get_daily(["AAPL"], start)

    # make the trailing-sync condition true: roll the covered end_date back and zero the sync time
    from sqlalchemy import update
    from app.models import PriceCoverage

    async with sessionmaker() as session:
        await session.execute(
            update(PriceCoverage).values(
                end_date=date.today() - timedelta(days=10),
                last_synced_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
            )
        )
        await session.commit()

    second = await store.get_daily(["AAPL"], start)
    # overlap comparison detects the halving -> whole ticker refetched, no stale values left
    assert second["AAPL"][0].close < first["AAPL"][0].close
    closes = {c.time: c.close for c in second["AAPL"]}
    assert all(abs(v - first_c.close / 2) < 0.02
               for first_c in first["AAPL"]
               if (v := closes.get(first_c.time)) is not None)


async def test_transient_empty_result_retries_on_later_sync(sessionmaker):
    class FlakyFake(CountingFake):
        """Returns empty the first time (simulating a transient upstream failure), then recovers."""

        async def get_daily_history(self, tickers, start, end):
            self.calls.append((tuple(tickers), start, end))
            if len(self.calls) == 1:
                return {t: [] for t in tickers}
            return await FakeMarketClient.get_daily_history(self, tickers, start, end)

    fake = FlakyFake()
    store = PriceStore(sessionmaker, fake)
    start = date.today() - timedelta(days=30)
    assert (await store.get_daily(["AAPL"], start))["AAPL"] == []

    # within an hour: no refetch (throttling still in effect)
    assert (await store.get_daily(["AAPL"], start))["AAPL"] == []
    assert len(fake.calls) == 1

    # simulate an hour later: roll the sync time back -> trailing sync refetches from scratch, self-heals
    from sqlalchemy import update
    from app.models import PriceCoverage

    async with sessionmaker() as session:
        await session.execute(update(PriceCoverage).values(
            last_synced_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        ))
        await session.commit()
    out = await store.get_daily(["AAPL"], start)
    assert len(out["AAPL"]) > 10


async def test_batched_overfetch_extends_coverage(sessionmaker):
    fake = CountingFake()
    store = PriceStore(sessionmaker, fake)
    deep = date.today() - timedelta(days=90)
    shallow = date.today() - timedelta(days=30)
    # first give VOO 30 days of coverage -> later it's fetched in the same batch as AAPL (90 days)
    await store.get_daily(["VOO"], shallow)
    await store.get_daily(["AAPL"], deep)  # batch contains only AAPL
    # AAPL's coverage start should be 90 days ago; asking for 60 days again must not trigger a refetch
    n_calls = len(fake.calls)
    out = await store.get_daily(["AAPL"], date.today() - timedelta(days=60))
    assert len(fake.calls) == n_calls
    assert out["AAPL"][0].time <= (date.today() - timedelta(days=55)).isoformat()


async def test_mixed_trailing_batch_only_rescaled_ticker_is_wiped(sessionmaker):
    class SelectiveRescalingFake(CountingFake):
        """Only AAPL is halved on subsequent calls; VOO keeps its original values."""

        async def get_daily_history(self, tickers, start, end):
            self.calls.append((tuple(tickers), start, end))
            out = await FakeMarketClient.get_daily_history(self, tickers, start, end)
            if len(self.calls) > 1 and "AAPL" in out:
                out["AAPL"] = [
                    Candle(time=c.time, open=c.open / 2, high=c.high / 2,
                           low=c.low / 2, close=c.close / 2, volume=c.volume)
                    for c in out["AAPL"]
                ]
            return out

    fake = SelectiveRescalingFake()
    store = PriceStore(sessionmaker, fake)
    start = date.today() - timedelta(days=60)
    first = await store.get_daily(["AAPL", "VOO"], start)

    from sqlalchemy import update
    from app.models import PriceCoverage

    async with sessionmaker() as session:
        await session.execute(update(PriceCoverage).values(
            end_date=date.today() - timedelta(days=10),
            last_synced_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        ))
        await session.commit()

    second = await store.get_daily(["AAPL", "VOO"], start)
    assert second["AAPL"][0].close < first["AAPL"][0].close      # AAPL refetched entirely (halved)
    assert second["VOO"][0].close == first["VOO"][0].close       # VOO unaffected
