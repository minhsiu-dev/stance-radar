from datetime import datetime, timedelta, timezone

import pytest

from app.insights.channel_win_rates import (
    WIN_RATE_WINDOW_DAYS,
    ChannelWinRate,
    get_channel_win_rates,
    reset_cache,
)
from app.insights.scorecard import summarize_channel_calls
from app.insights.channel_perf_sql import score_channel_calls_lean
from app.models import Channel, PriceBar, Stance, Video, VideoStance, VideoStatus

pytestmark = pytest.mark.asyncio

_NOW = datetime.now(timezone.utc)
_TODAY = _NOW.date()


async def _seed_two_channels(session) -> None:
    """ch_good buys a riser, ch_bad buys a faller. VOO is flat."""
    day = _TODAY - timedelta(days=210)
    while day <= _TODAY:
        n = (day - (_TODAY - timedelta(days=210))).days
        session.add(PriceBar(ticker="VOO", date=day, open=100.0, high=100.0,
                             low=100.0, close=100.0, volume=1))
        session.add(PriceBar(ticker="UP", date=day, open=100.0 + n, high=100.0 + n,
                             low=100.0 + n, close=100.0 + n, volume=1))
        session.add(PriceBar(ticker="DOWN", date=day, open=200.0 - n, high=200.0 - n,
                             low=200.0 - n, close=200.0 - n, volume=1))
        day += timedelta(days=1)
    for cid, ticker in (("ch_good", "UP"), ("ch_bad", "DOWN")):
        session.add(Channel(id=cid, title=cid, thumbnail_url="",
                            uploads_playlist_id=f"UU{cid}"))
        for k in range(3):
            vid = f"v_{cid}_{k}"
            session.add(Video(id=vid, channel_id=cid, title="t",
                              published_at=_NOW - timedelta(days=150 - k),
                              thumbnail_url="", duration_seconds=60,
                              status=VideoStatus.analyzed))
            session.add(VideoStance(video_id=vid, ticker=ticker,
                                    stance=Stance.buy, summary="s"))
    await session.commit()


async def test_win_rates_match_the_channel_performance_endpoint(session):
    """The number here MUST equal summary.buy["90"] from the per-channel path —
    that is the whole reason we reuse summarize_channel_calls."""
    await _seed_two_channels(session)
    rates = await get_channel_win_rates(session)

    cutoff = datetime.now(timezone.utc) - timedelta(days=WIN_RATE_WINDOW_DAYS)
    for cid in ("ch_good", "ch_bad"):
        cell = summarize_channel_calls(
            await score_channel_calls_lean(session, cid, cutoff)
        )["summary"]["buy"]["90"]
        assert rates[cid] == ChannelWinRate(win_rate=cell["win_rate"], n=cell["n"])

    assert rates["ch_good"].win_rate == 100.0
    assert rates["ch_bad"].win_rate == 0.0


async def test_channel_with_no_calls_is_absent(session):
    await _seed_two_channels(session)
    session.add(Channel(id="quiet", title="q", thumbnail_url="",
                        uploads_playlist_id="UUq"))
    await session.commit()
    rates = await get_channel_win_rates(session)
    assert "quiet" not in rates
    # callers treat a missing channel as unweighted -> channel_weight(None, 0) == 1.0


async def test_result_is_cached_within_the_ttl(session):
    await _seed_two_channels(session)
    first = await get_channel_win_rates(session)
    # a new channel appearing after the first call must NOT show up until the TTL lapses
    session.add(Channel(id="late", title="l", thumbnail_url="",
                        uploads_playlist_id="UUl"))
    session.add(Video(id="v_late", channel_id="late", title="t",
                      published_at=_NOW - timedelta(days=150), thumbnail_url="",
                      duration_seconds=60, status=VideoStatus.analyzed))
    session.add(VideoStance(video_id="v_late", ticker="UP",
                            stance=Stance.buy, summary="s"))
    await session.commit()

    assert await get_channel_win_rates(session) is first  # same object, no re-query
    reset_cache()
    assert "late" in await get_channel_win_rates(session)
