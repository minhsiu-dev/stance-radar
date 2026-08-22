from datetime import date, datetime, timedelta, timezone

import pytest

from app.api.insights import _channel_calls
from app.insights.channel_perf_sql import score_channel_calls_lean
from app.insights.scorecard import (
    SCORECARD_BENCHMARK,
    _SUMMARY_HORIZONS,
    build_channel_performance,
    summarize_channel_calls,
)
from app.market.client import Candle
from app.models import Channel, PriceBar, Stance, Video, VideoStance, VideoStatus

pytestmark = pytest.mark.asyncio

_NOW = datetime.now(timezone.utc)
_TODAY = _NOW.date()


def _d(days_ago: int) -> date:
    return _TODAY - timedelta(days=days_ago)


# deterministic daily close; the SAME formula feeds both price_bars and the StubStore series
def _close(ticker: str, day: date) -> float:
    base = 100 + (sum(ord(c) for c in ticker) % 60)
    return round(base + (day.toordinal() % 29) * 0.7, 2)


_PRICED = ["AAA", "BBB", "CCC", "VOO"]  # DDD intentionally has NO price bars
# (video_id, days_ago, ticker, stance)
_CALLS = [
    ("v_old", 200, "AAA", Stance.buy),   # outside the 180d window -> excluded by cutoff (both paths)
    ("v_aaa", 150, "AAA", Stance.buy),   # matured to 30 & 90
    ("v_bbb", 100, "BBB", Stance.sell),  # matured to 30 & 90
    ("v_ccc", 20, "CCC", Stance.buy),    # only "now" matured (younger than 30d)
    ("v_ddd", 150, "DDD", Stance.buy),   # no price data -> counted, but no realized cells
]


async def _seed(session) -> None:
    session.add(Channel(id="ch1", title="c", thumbnail_url="", uploads_playlist_id="UU1"))
    day = _d(210)
    while day <= _TODAY:
        for t in _PRICED:
            c = _close(t, day)
            session.add(PriceBar(ticker=t, date=day, open=c, high=c, low=c, close=c, volume=1))
        day += timedelta(days=1)
    for vid, ago, ticker, stance in _CALLS:
        session.add(Video(
            id=vid, channel_id="ch1", title=f"t {vid}",
            published_at=_NOW - timedelta(days=ago),
            thumbnail_url="", duration_seconds=60, status=VideoStatus.analyzed,
        ))
        session.add(VideoStance(video_id=vid, ticker=ticker, stance=stance, summary="s"))
    await session.commit()


class _StubStore:
    """duck-typed PriceStore returning canned candles (start ignored)."""

    def __init__(self, data: dict[str, list[Candle]]) -> None:
        self._data = data

    async def get_daily(self, tickers, start):
        return {t: self._data.get(t, []) for t in tickers}


def _series() -> dict[str, list[Candle]]:
    out: dict[str, list[Candle]] = {}
    day = _d(210)
    while day <= _TODAY:
        for t in _PRICED:
            c = _close(t, day)
            out.setdefault(t, []).append(Candle(
                time=day.isoformat(), open=c, high=c, low=c, close=c, volume=1,
            ))
        day += timedelta(days=1)
    return out


async def test_lean_matches_build_channel_performance(session):
    await _seed(session)
    cutoff = _NOW - timedelta(days=180)

    # OLD heavy path: StubStore returns candles identical to price_bars
    raw_calls = await _channel_calls(session, "ch1", cutoff=cutoff)
    old = await build_channel_performance(_StubStore(_series()), raw_calls, window_days=180)

    # NEW lean path: indexed price_bars SQL + the SAME aggregation
    calls = await score_channel_calls_lean(session, "ch1", cutoff)
    new = {
        "benchmark": SCORECARD_BENCHMARK,
        "window_days": 180,
        "horizons": list(_SUMMARY_HORIZONS),
        **summarize_channel_calls(calls),
    }

    assert new == old
    # sanity on the seed: the 200d call was cut by the window -> 4 directional calls counted
    assert old["counts"]["all"] == 4
    # AAA(150) + BBB(100) matured to 90; CCC(20) did not; DDD has no data
    assert old["summary"]["all"]["90"]["n"] >= 1
    assert old["summary"]["all"]["now"]["n"] >= 1


async def test_batch_matches_per_channel_bit_for_bit(session):
    """score_all_channel_calls_lean must be indistinguishable from calling
    score_channel_calls_lean once per channel. If these ever diverge, the /stocks
    page and the channel page would show two different "win rates" for the same
    channel."""
    from app.insights.channel_perf_sql import score_all_channel_calls_lean

    await _seed(session)
    # a second channel with its own calls, so the batch has something to group by
    session.add(Channel(id="ch2", title="c2", thumbnail_url="", uploads_playlist_id="UU2"))
    session.add(Video(
        id="v2_aaa", channel_id="ch2", title="t",
        published_at=_NOW - timedelta(days=120), thumbnail_url="",
        duration_seconds=60, status=VideoStatus.analyzed,
    ))
    session.add(VideoStance(video_id="v2_aaa", ticker="BBB", stance=Stance.buy, summary="s"))
    await session.commit()

    cutoff = _NOW - timedelta(days=180)
    batch = await score_all_channel_calls_lean(session, cutoff)
    assert set(batch) == {"ch1", "ch2"}

    for cid in ("ch1", "ch2"):
        single = await score_channel_calls_lean(session, cid, cutoff)
        # sentinel keeps this a total order: some calls (e.g. the DDD ticker with no
        # price_bars) have all-None returns, and None/float aren't comparable with <
        _none = float("-inf")
        key = lambda c: (
            c.stance,
            c.now_return if c.now_return is not None else _none,
            c.returns.get(30) if c.returns.get(30) is not None else _none,
            c.returns.get(90) if c.returns.get(90) is not None else _none,
        )
        assert sorted(batch[cid], key=key) == sorted(single, key=key)
        # and the thing we actually consume survives the round trip
        assert (summarize_channel_calls(batch[cid])["summary"]["buy"]["90"]
                == summarize_channel_calls(single)["summary"]["buy"]["90"])


async def test_batch_omits_channels_with_no_directional_calls(session):
    from app.insights.channel_perf_sql import score_all_channel_calls_lean

    await _seed(session)
    session.add(Channel(id="quiet", title="q", thumbnail_url="", uploads_playlist_id="UUq"))
    await session.commit()

    batch = await score_all_channel_calls_lean(session, _NOW - timedelta(days=180))
    assert "quiet" not in batch
