"""Lean per-call scoring for the channel /performance summary: one indexed price_bars
pass fetches the entry / now / 30 / 90 stock-and-VOO closes per directional call in the
window; the return/alpha arithmetic is done in PYTHON so it matches score_call's
_window_return/_now_return bit-for-bit (same float math, same round()). Avoids loading
full price series and needs no PriceStore (reads price_bars directly). The CallScores
feed the existing summarize_channel_calls, so /performance's output is unchanged (see
tests/unit/test_channel_perf_sql.py)."""
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.insights.scorecard import SCORECARD_BENCHMARK, CallScore

# entry = first (date, close) on/after the call date (LATERAL, the date anchors 30/90);
# now = latest close; 30/90 = first close >= entry_date + N (NULL if unmatured). VOO scored
# the same way. ONLY raw closes are returned — no SQL arithmetic — so rounding happens in
# Python (banker's) identically to score_call. One (ticker,date) index seek per leg.
_SCORE_SQL = text("""
WITH calls AS (
    SELECT vs.ticker, vs.stance, (v.published_at AT TIME ZONE 'UTC')::date AS d
    FROM video_stances vs
    JOIN videos v ON vs.video_id = v.id
    WHERE v.channel_id = :cid AND vs.stance <> 'neutral' AND v.published_at >= :cutoff
)
SELECT c.stance,
    se.ec AS entry,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = c.ticker
     ORDER BY pb.date DESC LIMIT 1)                                              AS now_c,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = c.ticker AND pb.date >= se.ed + 30
     ORDER BY pb.date LIMIT 1)                                                   AS e30,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = c.ticker AND pb.date >= se.ed + 90
     ORDER BY pb.date LIMIT 1)                                                   AS e90,
    ve.ec AS voo_entry,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = :bench
     ORDER BY pb.date DESC LIMIT 1)                                             AS voo_now,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = :bench AND pb.date >= ve.ed + 30
     ORDER BY pb.date LIMIT 1)                                                  AS voo30,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = :bench AND pb.date >= ve.ed + 90
     ORDER BY pb.date LIMIT 1)                                                  AS voo90
FROM calls c
LEFT JOIN LATERAL (
    SELECT pb.date AS ed, pb.close AS ec FROM price_bars pb
    WHERE pb.ticker = c.ticker AND pb.date >= c.d ORDER BY pb.date LIMIT 1
) se ON true
LEFT JOIN LATERAL (
    SELECT pb.date AS ed, pb.close AS ec FROM price_bars pb
    WHERE pb.ticker = :bench AND pb.date >= c.d ORDER BY pb.date LIMIT 1
) ve ON true
""")


def _f(v) -> float | None:
    return float(v) if v is not None else None


def _ret(exit_c: float | None, entry_c: float | None) -> float | None:
    # mirrors _window_return/_now_return: None if no exit bar or zero entry
    if exit_c is None or entry_c is None or entry_c == 0:
        return None
    return round((exit_c / entry_c - 1) * 100, 2)


def _alpha(ret: float | None, bench_ret: float | None) -> float | None:
    # mirrors score_call: round(ret - bench_ret, 2), None unless both present
    if ret is None or bench_ret is None:
        return None
    return round(ret - bench_ret, 2)


# Same legs as _SCORE_SQL, minus the channel filter and plus channel_id in the
# projection, so one pass scores every channel. Measured 2026-08-22 on the live db:
# 18 channels / 2691 directional calls / 461k price_bars -> 29.8ms, all buffer hits.
_SCORE_ALL_SQL = text("""
WITH calls AS (
    SELECT v.channel_id, vs.ticker, vs.stance, (v.published_at AT TIME ZONE 'UTC')::date AS d
    FROM video_stances vs
    JOIN videos v ON vs.video_id = v.id
    WHERE vs.stance <> 'neutral' AND v.published_at >= :cutoff
)
SELECT c.channel_id, c.stance,
    se.ec AS entry,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = c.ticker
     ORDER BY pb.date DESC LIMIT 1)                                              AS now_c,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = c.ticker AND pb.date >= se.ed + 30
     ORDER BY pb.date LIMIT 1)                                                   AS e30,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = c.ticker AND pb.date >= se.ed + 90
     ORDER BY pb.date LIMIT 1)                                                   AS e90,
    ve.ec AS voo_entry,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = :bench
     ORDER BY pb.date DESC LIMIT 1)                                             AS voo_now,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = :bench AND pb.date >= ve.ed + 30
     ORDER BY pb.date LIMIT 1)                                                  AS voo30,
    (SELECT pb.close FROM price_bars pb WHERE pb.ticker = :bench AND pb.date >= ve.ed + 90
     ORDER BY pb.date LIMIT 1)                                                  AS voo90
FROM calls c
LEFT JOIN LATERAL (
    SELECT pb.date AS ed, pb.close AS ec FROM price_bars pb
    WHERE pb.ticker = c.ticker AND pb.date >= c.d ORDER BY pb.date LIMIT 1
) se ON true
LEFT JOIN LATERAL (
    SELECT pb.date AS ed, pb.close AS ec FROM price_bars pb
    WHERE pb.ticker = :bench AND pb.date >= c.d ORDER BY pb.date LIMIT 1
) ve ON true
""")


def _row_to_call(r) -> CallScore:
    """Shared by both paths so the float math cannot drift between them."""
    entry = _f(r.entry)
    voo_entry = _f(r.voo_entry)
    ret_now = _ret(_f(r.now_c), entry)
    ret_30 = _ret(_f(r.e30), entry)
    ret_90 = _ret(_f(r.e90), entry)
    voo_now = _ret(_f(r.voo_now), voo_entry)
    voo_30 = _ret(_f(r.voo30), voo_entry)
    voo_90 = _ret(_f(r.voo90), voo_entry)
    stance = r.stance.value if hasattr(r.stance, "value") else r.stance
    return CallScore(
        video_id="", video_title="", ticker="", stance=stance,
        confidence=None, summary="", published_at="",
        returns={30: ret_30, 90: ret_90},
        alpha={30: _alpha(ret_30, voo_30), 90: _alpha(ret_90, voo_90)},
        now_return=ret_now,
        now_alpha=_alpha(ret_now, voo_now),
    )


async def score_channel_calls_lean(
    session: AsyncSession,
    channel_id: str,
    cutoff: datetime,
    benchmark: str = SCORECARD_BENCHMARK,
) -> list[CallScore]:
    """One CallScore per directional call (stance != neutral, published_at >= cutoff) for
    the channel, with now/30/90 returns + alpha vs VOO. Only the fields
    summarize_channel_calls reads (stance, now_*/alpha/returns) are meaningful; the rest
    are placeholders. A ticker with no price_bars -> NULL entry -> all-None returns
    (counted, contributes to no cell), matching score_call's has_data=False."""
    rows = (await session.execute(
        _SCORE_SQL, {"cid": channel_id, "cutoff": cutoff, "bench": benchmark}
    )).all()
    calls: list[CallScore] = []
    for r in rows:
        calls.append(_row_to_call(r))
    return calls


async def score_all_channel_calls_lean(
    session: AsyncSession,
    cutoff: datetime,
    benchmark: str = SCORECARD_BENCHMARK,
) -> dict[str, list[CallScore]]:
    """score_channel_calls_lean for EVERY channel in one pass, keyed by channel_id.
    Channels with no directional call in the window are absent from the result."""
    rows = (await session.execute(
        _SCORE_ALL_SQL, {"cutoff": cutoff, "bench": benchmark}
    )).all()
    out: dict[str, list[CallScore]] = {}
    for r in rows:
        out.setdefault(r.channel_id, []).append(_row_to_call(r))
    return out
