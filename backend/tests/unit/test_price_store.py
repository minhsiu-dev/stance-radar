from datetime import date

import pytest
from sqlalchemy import select

from app.market.client import Candle
from app.market.store import PriceStore
from app.models import PriceBar

pytestmark = pytest.mark.asyncio


class _StubMarket:
    """Minimal MarketClient: returns canned candles, ignores the date window."""

    def __init__(self, data: dict[str, list[Candle]]) -> None:
        self._data = data

    async def get_daily_history(self, tickers, start, end):
        return {t: self._data.get(t, []) for t in tickers}


async def test_ensure_daily_persists_without_returning(sessionmaker):
    candles = [
        Candle(time="2026-01-02", open=1.0, high=1.0, low=1.0, close=10.0, volume=1),
        Candle(time="2026-01-05", open=1.0, high=1.0, low=1.0, close=11.0, volume=1),
    ]
    store = PriceStore(sessionmaker, _StubMarket({"AAA": candles}))

    result = await store.ensure_daily(["AAA"], date(2026, 1, 1))
    assert result is None  # ensure_daily persists only; it does not load/return series

    async with sessionmaker() as s:
        bars = (await s.execute(
            select(PriceBar).where(PriceBar.ticker == "AAA")
        )).scalars().all()
    assert {b.date.isoformat() for b in bars} == {"2026-01-02", "2026-01-05"}

    # get_daily still works on top of the refactor and reads the persisted bars back
    out = await store.get_daily(["AAA"], date(2026, 1, 1))
    assert [c.close for c in out["AAA"]] == [10.0, 11.0]
