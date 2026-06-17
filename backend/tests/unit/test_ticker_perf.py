from datetime import date, datetime, timezone

import pytest

from app.insights.scorecard import CallScore, PriceSeries, _adjusted_alpha, _adjusted_return, score_call
from app.insights.ticker_perf import channel_ticker_performance
from app.models import Channel, PriceBar, Stance, Video, VideoStance, VideoStatus

pytestmark = pytest.mark.asyncio

# VOO is NON-flat (100 -> 110 over the window) so avg_return (raw) differs from avg_alpha (excess vs VOO).
CANDLES: dict[str, list[tuple[date, float]]] = {
    "VOO": [(date(2026, 1, 10), 100.0), (date(2026, 3, 10), 105.0), (date(2026, 6, 1), 110.0)],
    "AAA": [(date(2026, 1, 10), 100.0), (date(2026, 6, 1), 130.0)],   # buy: raw +30, alpha +20
    "BBB": [(date(2026, 1, 10), 100.0), (date(2026, 6, 1), 80.0)],    # sell: raw -20 -> adj +20, alpha -30 -> adj +30
    "CCC": [(date(2026, 1, 10), 100.0), (date(2026, 3, 10), 200.0), (date(2026, 6, 1), 120.0)],
}
CALLS = [
    ("v_aaa", date(2026, 1, 10), "AAA", Stance.buy),
    ("v_bbb", date(2026, 1, 10), "BBB", Stance.sell),
    ("v_ccc1", date(2026, 1, 10), "CCC", Stance.buy),   # entry 100 -> 120 raw +20, bench +10 -> alpha +10 (win)
    ("v_ccc2", date(2026, 3, 10), "CCC", Stance.buy),   # entry 200 -> 120 raw -40, bench 4.76 -> alpha -44.76 (loss)
    ("v_ddd", date(2026, 1, 10), "DDD", Stance.neutral),  # neutral -> excluded
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


async def test_channel_ticker_performance_slices(session):
    await _seed(session)
    perf = await channel_ticker_performance(session, "ch1")

    assert perf["AAA"] == {
        "all":  {"n": 1, "avg_alpha": 20.0, "avg_return": 30.0, "win_rate": 100.0},
        "buy":  {"n": 1, "avg_alpha": 20.0, "avg_return": 30.0, "win_rate": 100.0},
        "sell": {"n": 0, "avg_alpha": None, "avg_return": None, "win_rate": None},
    }
    assert perf["BBB"] == {
        "all":  {"n": 1, "avg_alpha": 30.0, "avg_return": 20.0, "win_rate": 100.0},
        "buy":  {"n": 0, "avg_alpha": None, "avg_return": None, "win_rate": None},
        "sell": {"n": 1, "avg_alpha": 30.0, "avg_return": 20.0, "win_rate": 100.0},
    }
    assert perf["CCC"] == {
        "all":  {"n": 2, "avg_alpha": -17.38, "avg_return": -10.0, "win_rate": 50.0},
        "buy":  {"n": 2, "avg_alpha": -17.38, "avg_return": -10.0, "win_rate": 50.0},
        "sell": {"n": 0, "avg_alpha": None, "avg_return": None, "win_rate": None},
    }
    # avg_return is the RAW stock move, distinct from avg_alpha (excess vs the non-flat VOO)
    assert perf["AAA"]["all"]["avg_return"] != perf["AAA"]["all"]["avg_alpha"]
    assert "DDD" not in perf


async def test_channel_ticker_performance_matches_score_call(session):
    """The lean SQL must agree, per ticker, with score_call's 至今 alpha AND raw return."""
    await _seed(session)
    perf = await channel_ticker_performance(session, "ch1")

    series = {
        t: PriceSeries(dates=tuple(d for d, _ in bars), closes=tuple(c for _, c in bars))
        for t, bars in CANDLES.items()
    }
    alpha_by: dict[str, list[float]] = {}
    ret_by: dict[str, list[float]] = {}
    for vid, d, ticker, stance in CALLS:
        if stance == Stance.neutral:
            continue
        pub = datetime(d.year, d.month, d.day, 12, 0, tzinfo=timezone.utc)
        cs = CallScore(
            video_id=vid, video_title="", ticker=ticker, stance=stance.value,
            confidence=None, summary="", published_at=pub.isoformat(),
        )
        score_call(cs, series.get(ticker), series["VOO"], pub.date())
        a = _adjusted_alpha(cs, "now")
        r = _adjusted_return(cs, "now")
        if a is not None:
            alpha_by.setdefault(ticker, []).append(a)
        if r is not None:
            ret_by.setdefault(ticker, []).append(r)

    assert set(perf) == set(alpha_by)
    for ticker, alphas in alpha_by.items():
        n = len(alphas)
        rets = ret_by[ticker]
        assert perf[ticker]["all"]["n"] == n
        assert perf[ticker]["all"]["avg_alpha"] == pytest.approx(round(sum(alphas) / n, 2))
        assert perf[ticker]["all"]["avg_return"] == pytest.approx(round(sum(rets) / len(rets), 2))
        assert perf[ticker]["all"]["win_rate"] == pytest.approx(
            round(100.0 * sum(1 for a in alphas if a > 0) / n, 1)
        )
