from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.insights.scorecard import PriceSeries
from app.insights.ticker_perf import channel_ticker_performance
from app.models import Channel, PriceBar, Stance, Video, VideoStance, VideoStatus

pytestmark = pytest.mark.asyncio


def _rhu(x: float, ndigits: int = 2) -> float:
    """Round half-away-from-zero (matches Postgres round(numeric), unlike Python's banker's round)."""
    return float(Decimal(str(x)).quantize(Decimal(1).scaleb(-ndigits), rounding=ROUND_HALF_UP))

_NOW = datetime.now(timezone.utc)
_TODAY = _NOW.date()


def _d(days_ago: int) -> date:
    return _TODAY - timedelta(days=days_ago)


# Deterministic daily close: ticker-specific base + a small date-driven wiggle. Dense (every
# calendar day) so any window end (te) lands on a bar. The Python oracle reads the SAME formula.
def _close(ticker: str, day: date) -> float:
    base = 100 + (sum(ord(c) for c in ticker) % 50)
    return round(base + (day.toordinal() % 23) * 0.5, 2)


_TICKERS = ["AAA", "BBB", "CCC", "VOO"]
# (video_id, days_ago, ticker, stance)
_CALLS = [
    # AAA: buy reversed EARLY (10d after) -> closed, scored over the 10-day window (NOT to today)
    ("v_aaa_b", 150, "AAA", Stance.buy),
    ("v_aaa_s", 140, "AAA", Stance.sell),
    # BBB: buy then -> NEUTRAL (a change) 30d later -> closed at the neutral date
    ("v_bbb_b", 160, "BBB", Stance.buy),
    ("v_bbb_n", 130, "BBB", Stance.neutral),
    # CCC: one open MATURE buy (120d old, never reversed -> mark-to-market today) and
    #      one open IMMATURE buy (20d old -> pending)
    ("v_ccc_old", 120, "CCC", Stance.buy),
    ("v_ccc_new", 20, "CCC", Stance.buy),
]


async def _seed(session) -> None:
    session.add(Channel(id="ch1", title="c", thumbnail_url="", uploads_playlist_id="UU1"))
    start = _d(210)
    for t in _TICKERS:
        day = start
        while day <= _TODAY:
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


# ---- independent Python oracle (mirrors spec §2, NOT the SQL) ----
def _series(ticker: str) -> PriceSeries:
    days = []
    day = _d(210)
    while day <= _TODAY:
        days.append(day)
        day += timedelta(days=1)
    return PriceSeries(dates=tuple(days), closes=tuple(_close(ticker, d) for d in days))


def _close_on_or_after(s: PriceSeries, target: date):
    hit = s.close_on_or_after(target)
    return hit[1] if hit is not None else s.closes[-1]  # te past last bar -> latest (mark-to-market)


def _oracle(mode: str = "matured") -> dict:
    all_stances = [(t, st, _d(ago)) for (_, ago, t, st) in _CALLS]
    voo = _series("VOO")
    out: dict = {}
    for vid, ago, ticker, stance in _CALLS:
        if stance == Stance.neutral:
            continue
        d0 = _d(ago)
        later = [ad for (at, ast, ad) in all_stances if at == ticker and ad > d0 and ast != stance]
        tc = min(later) if later else None
        if mode == "incl":
            matured = True
            te = min(d0 + timedelta(days=90), tc if tc is not None else _TODAY)
        else:
            matured = tc is not None or (d0 + timedelta(days=90)) <= _TODAY
            te = tc if tc is not None else _TODAY
        slot = out.setdefault(ticker, {"alphas": {"buy": [], "sell": []}, "rets": {"buy": [], "sell": []},
                                       "pending": {"buy": 0, "sell": 0}})
        sl = stance.value
        if not matured:
            slot["pending"][sl] += 1
            continue
        s = _series(ticker)
        entry = s.close_on_or_after(d0)
        if entry is None or entry[1] <= 0:
            continue
        exit_px = _close_on_or_after(s, te)
        voo_e = voo.close_on_or_after(d0)
        if voo_e is None or voo_e[1] <= 0:
            continue
        voo_l = _close_on_or_after(voo, te)
        stock = _rhu((exit_px / entry[1] - 1) * 100, 2)
        bench = _rhu((voo_l / voo_e[1] - 1) * 100, 2)
        alpha = _rhu(stock - bench, 2)
        adj_a = alpha if stance == Stance.buy else -alpha
        adj_r = stock if stance == Stance.buy else -stock
        slot["alphas"][sl].append(adj_a)
        slot["rets"][sl].append(adj_r)
    return out


def _expected_slice(slot, which: str) -> dict:
    if which == "all":
        alphas = slot["alphas"]["buy"] + slot["alphas"]["sell"]
        rets = slot["rets"]["buy"] + slot["rets"]["sell"]
        pending = slot["pending"]["buy"] + slot["pending"]["sell"]
    else:
        alphas, rets, pending = slot["alphas"][which], slot["rets"][which], slot["pending"][which]
    n = len(alphas)
    return {
        "n": n,
        "avg_alpha": _rhu(sum(alphas) / n, 2) if n else None,
        "avg_return": _rhu(sum(rets) / n, 2) if n else None,
        "win_rate": _rhu(100.0 * sum(1 for a in alphas if a > 0) / n, 1) if n else None,
        "pending": pending,
    }


async def test_track_record_window_structural(session):
    await _seed(session)
    perf = await channel_ticker_performance(session, "ch1")

    # AAA buy (150d ago) was reversed by sell (140d ago) -> CLOSED, scored over 10-day window
    # AAA sell (140d ago) is open, BUT 140d >= 90d so it is MATURE -> scored to today (not pending)
    assert perf["AAA"]["buy"]["n"] == 1
    assert perf["AAA"]["sell"]["n"] == 1   # mature (140d old) open sell -> scored to today
    assert perf["AAA"]["sell"]["pending"] == 0
    assert perf["AAA"]["all"]["n"] == 2
    # BBB buy was closed by a move to NEUTRAL -> scored (neutral counts as a change)
    assert perf["BBB"]["buy"]["n"] == 1
    assert perf["BBB"]["buy"]["pending"] == 0
    # CCC: one mature open buy (120d, scored to today) + one immature open buy (20d -> pending)
    assert perf["CCC"]["buy"]["n"] == 1
    assert perf["CCC"]["buy"]["pending"] == 1


async def test_track_record_window_matches_oracle(session):
    await _seed(session)
    for mode in ("matured", "incl"):
        perf = await channel_ticker_performance(session, "ch1", mode=mode)
        oracle = _oracle(mode)
        assert set(perf) == set(oracle), mode
        for ticker, slot in oracle.items():
            for which in ("all", "buy", "sell"):
                exp = _expected_slice(slot, which)
                got = perf[ticker][which]
                assert got["n"] == exp["n"], (mode, ticker, which, "n")
                assert got["pending"] == exp["pending"], (mode, ticker, which, "pending")
                for k in ("avg_alpha", "avg_return", "win_rate"):
                    if exp[k] is None:
                        assert got[k] is None, (mode, ticker, which, k)
                    else:
                        assert got[k] == pytest.approx(exp[k]), (mode, ticker, which, k)


async def test_track_record_incl_counts_young(session):
    await _seed(session)
    matured = await channel_ticker_performance(session, "ch1", mode="matured")
    incl = await channel_ticker_performance(session, "ch1", mode="incl")
    # CCC has a mature open buy (scored) + a 20-day open buy (pending under matured):
    assert matured["CCC"]["buy"]["n"] == 1 and matured["CCC"]["buy"]["pending"] == 1
    # incl folds the young buy in (scored to-date) -> 2 scored, none pending:
    assert incl["CCC"]["buy"]["n"] == 2 and incl["CCC"]["buy"]["pending"] == 0
