from datetime import date, datetime, timezone

import pytest

from app.insights.scorecard import CallScore, PriceSeries, _adjusted_alpha, score_call
from app.insights.ticker_perf import channel_ticker_performance
from app.models import Channel, PriceBar, Stance, Video, VideoStance, VideoStatus

pytestmark = pytest.mark.asyncio

# (date, close) per ticker. VOO is flat at 100 -> benchmark "now" return is 0,
# so the stance-adjusted alpha equals the (sign-flipped) raw return -> easy to hand-check.
CANDLES: dict[str, list[tuple[date, float]]] = {
    "VOO": [(date(2026, 1, 10), 100.0), (date(2026, 3, 10), 100.0), (date(2026, 6, 1), 100.0)],
    "AAA": [(date(2026, 1, 10), 100.0), (date(2026, 6, 1), 110.0)],   # buy: +10% -> +10 alpha (win)
    "BBB": [(date(2026, 1, 10), 100.0), (date(2026, 6, 1), 80.0)],    # sell: -20% -> +20 adj alpha (win)
    "CCC": [(date(2026, 1, 10), 100.0), (date(2026, 3, 10), 200.0), (date(2026, 6, 1), 110.0)],
}
# (video_id, published_date, ticker, stance)
CALLS = [
    ("v_aaa", date(2026, 1, 10), "AAA", Stance.buy),
    ("v_bbb", date(2026, 1, 10), "BBB", Stance.sell),
    ("v_ccc1", date(2026, 1, 10), "CCC", Stance.buy),   # entry 100 -> 110 = +10 (win)
    ("v_ccc2", date(2026, 3, 10), "CCC", Stance.buy),   # entry 200 -> 110 = -45 (loss)
    ("v_ddd", date(2026, 1, 10), "DDD", Stance.neutral),  # neutral -> excluded entirely
]


async def _seed(session) -> None:
    session.add(Channel(id="ch1", title="c", thumbnail_url="", uploads_playlist_id="UU1"))
    for ticker, bars in CANDLES.items():
        for d, close in bars:
            session.add(PriceBar(
                ticker=ticker, date=d, open=close, high=close, low=close,
                close=close, volume=1,
            ))
    for vid, d, ticker, stance in CALLS:
        session.add(Video(
            id=vid, channel_id="ch1", title=f"t {vid}",
            published_at=datetime(d.year, d.month, d.day, 12, 0, tzinfo=timezone.utc),
            thumbnail_url="", duration_seconds=60, status=VideoStatus.analyzed,
        ))
        session.add(VideoStance(video_id=vid, ticker=ticker, stance=stance, summary="s"))
    await session.commit()


async def test_channel_ticker_performance_exact(session):
    await _seed(session)
    perf = await channel_ticker_performance(session, "ch1")

    assert perf["AAA"] == {"n": 1, "avg_alpha": 10.0, "win_rate": 100.0}
    assert perf["BBB"] == {"n": 1, "avg_alpha": 20.0, "win_rate": 100.0}
    assert perf["CCC"] == {"n": 2, "avg_alpha": -17.5, "win_rate": 50.0}
    assert "DDD" not in perf  # neutral-only ticker never appears in the perf result


async def test_channel_ticker_performance_matches_score_call(session):
    """The lean SQL must agree, per ticker, with score_call's 至今 numbers."""
    await _seed(session)
    perf = await channel_ticker_performance(session, "ch1")

    series = {
        t: PriceSeries(
            dates=tuple(d for d, _ in bars),
            closes=tuple(c for _, c in bars),
        )
        for t, bars in CANDLES.items()
    }
    by_ticker: dict[str, list[float]] = {}
    for vid, d, ticker, stance in CALLS:
        if stance == Stance.neutral:
            continue
        pub = datetime(d.year, d.month, d.day, 12, 0, tzinfo=timezone.utc)
        cs = CallScore(
            video_id=vid, video_title="", ticker=ticker, stance=stance.value,
            confidence=None, summary="", published_at=pub.isoformat(),
        )
        score_call(cs, series.get(ticker), series["VOO"], pub.date())
        adj = _adjusted_alpha(cs, "now")
        if adj is not None:
            by_ticker.setdefault(ticker, []).append(adj)

    assert set(perf) == set(by_ticker)
    for ticker, adjs in by_ticker.items():
        n = len(adjs)
        expected_avg = round(sum(adjs) / n, 2)
        expected_win = round(100.0 * sum(1 for a in adjs if a > 0) / n, 1)
        assert perf[ticker]["n"] == n
        assert perf[ticker]["avg_alpha"] == pytest.approx(expected_avg)
        assert perf[ticker]["win_rate"] == pytest.approx(expected_win)
