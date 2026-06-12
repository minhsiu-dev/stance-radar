from datetime import date, timedelta

from app.market.client import Candle, FakeMarketClient
from app.market.store import PriceStore


class CountingFake(FakeMarketClient):
    def __init__(self):
        self.calls: list[tuple[tuple[str, ...], date, date]] = []

    async def get_daily_history(self, tickers, start, end):
        self.calls.append((tuple(tickers), start, end))
        return await super().get_daily_history(tickers, start, end)


class RescalingFake(CountingFake):
    """模擬除權息後整條序列被重新調整:第二次起所有收盤價砍半。"""

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
    assert len(fake.calls) == 1  # 兩檔一次批次抓
    assert len(out["AAPL"]) > 10
    assert out["AAPL"][0].time >= start.isoformat()


async def test_second_call_within_hour_hits_db_only(sessionmaker):
    fake = CountingFake()
    store = PriceStore(sessionmaker, fake)
    start = date.today() - timedelta(days=30)
    first = await store.get_daily(["AAPL"], start)
    second = await store.get_daily(["AAPL"], start)
    assert len(fake.calls) == 1  # 第二次完全走 DB
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
    assert len(fake.calls) == 1  # coverage 記住了「查過沒資料」


async def test_rescaled_series_is_wiped_and_refetched(sessionmaker):
    fake = RescalingFake()
    store = PriceStore(sessionmaker, fake)
    start = date.today() - timedelta(days=60)
    first = await store.get_daily(["AAPL"], start)

    # 讓尾段同步條件成立:把涵蓋的 end_date 倒退、同步時間歸零
    from sqlalchemy import update
    from app.models import PriceCoverage
    from datetime import datetime, timezone

    async with sessionmaker() as session:
        await session.execute(
            update(PriceCoverage).values(
                end_date=date.today() - timedelta(days=10),
                last_synced_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
            )
        )
        await session.commit()

    second = await store.get_daily(["AAPL"], start)
    # overlap 比對發現砍半 → 整檔重抓,舊值不殘留
    assert second["AAPL"][0].close < first["AAPL"][0].close
    closes = {c.time: c.close for c in second["AAPL"]}
    assert all(abs(v - first_c.close / 2) < 0.02
               for first_c in first["AAPL"]
               if (v := closes.get(first_c.time)) is not None)
