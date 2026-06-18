"""Lean per-call scoring for the channel /performance summary: one indexed price_bars
pass computes the now/30/90 stock-and-VOO windowed returns per directional call in the
window, mirroring score_call's _window_return/_now_return. Avoids loading full price
series into Python and needs no PriceStore (reads price_bars directly). The resulting
CallScores feed the existing summarize_channel_calls, so /performance's output is
unchanged (see tests/unit/test_channel_perf_sql.py)."""
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.insights.scorecard import SCORECARD_BENCHMARK, CallScore

# entry  = first close on/after the call date (LATERAL, also yields the entry DATE for the
#          30/90 anchor); now = latest close; 30/90 = first close >= entry_date + N (NULL if
#          unmatured). VOO scored the same way. close is double precision -> round() casts
#          ::numeric; NULLIF guards the divisions. One (ticker,date) index seek per leg.
# Caveat: Postgres round(numeric) is half-away-from-zero while Python round() is banker's, so
# this path and the old score_call path can differ by one cent on a value landing exactly on a
# .xx5 boundary — vanishingly rare with continuous price ratios and immaterial after avg/median,
# so the two are equivalent in practice (the consistency test asserts it on non-boundary data),
# not provably bit-for-bit identical.
_SCORE_SQL = text("""
WITH calls AS (
    SELECT vs.ticker, vs.stance, (v.published_at AT TIME ZONE 'UTC')::date AS d
    FROM video_stances vs
    JOIN videos v ON vs.video_id = v.id
    WHERE v.channel_id = :cid AND vs.stance <> 'neutral' AND v.published_at >= :cutoff
),
scored AS (
    SELECT c.ticker, c.stance, se.ec AS entry,
        (SELECT pb.close FROM price_bars pb WHERE pb.ticker = c.ticker
         ORDER BY pb.date DESC LIMIT 1)                                              AS now_c,
        (SELECT pb.close FROM price_bars pb WHERE pb.ticker = c.ticker AND pb.date >= se.ed + 30
         ORDER BY pb.date LIMIT 1)                                                   AS e30,
        (SELECT pb.close FROM price_bars pb WHERE pb.ticker = c.ticker AND pb.date >= se.ed + 90
         ORDER BY pb.date LIMIT 1)                                                   AS e90,
        ve.ec AS voo_entry,
        (SELECT pb.close FROM price_bars pb WHERE pb.ticker = :bench
         ORDER BY pb.date DESC LIMIT 1)                                              AS voo_now,
        (SELECT pb.close FROM price_bars pb WHERE pb.ticker = :bench AND pb.date >= ve.ed + 30
         ORDER BY pb.date LIMIT 1)                                                   AS voo30,
        (SELECT pb.close FROM price_bars pb WHERE pb.ticker = :bench AND pb.date >= ve.ed + 90
         ORDER BY pb.date LIMIT 1)                                                   AS voo90
    FROM calls c
    LEFT JOIN LATERAL (
        SELECT pb.date AS ed, pb.close AS ec FROM price_bars pb
        WHERE pb.ticker = c.ticker AND pb.date >= c.d ORDER BY pb.date LIMIT 1
    ) se ON true
    LEFT JOIN LATERAL (
        SELECT pb.date AS ed, pb.close AS ec FROM price_bars pb
        WHERE pb.ticker = :bench AND pb.date >= c.d ORDER BY pb.date LIMIT 1
    ) ve ON true
)
SELECT stance,
    round(((now_c / NULLIF(entry, 0) - 1) * 100)::numeric, 2)  AS ret_now,
    round(((e30  / NULLIF(entry, 0) - 1) * 100)::numeric, 2)   AS ret_30,
    round(((e90  / NULLIF(entry, 0) - 1) * 100)::numeric, 2)   AS ret_90,
    round(
        round(((now_c / NULLIF(entry, 0) - 1) * 100)::numeric, 2)
        - round(((voo_now / NULLIF(voo_entry, 0) - 1) * 100)::numeric, 2), 2)  AS alpha_now,
    round(
        round(((e30 / NULLIF(entry, 0) - 1) * 100)::numeric, 2)
        - round(((voo30 / NULLIF(voo_entry, 0) - 1) * 100)::numeric, 2), 2)    AS alpha_30,
    round(
        round(((e90 / NULLIF(entry, 0) - 1) * 100)::numeric, 2)
        - round(((voo90 / NULLIF(voo_entry, 0) - 1) * 100)::numeric, 2), 2)    AS alpha_90
FROM scored
""")


def _f(v) -> float | None:
    return float(v) if v is not None else None


async def score_channel_calls_lean(
    session: AsyncSession,
    channel_id: str,
    cutoff: datetime,
    benchmark: str = SCORECARD_BENCHMARK,
) -> list[CallScore]:
    """One CallScore per directional call (stance != neutral, published_at >= cutoff) for
    the channel, with now/30/90 returns + alpha vs VOO scored over price_bars. Only the
    fields summarize_channel_calls reads (stance, now_*/alpha/returns) are meaningful;
    the rest are placeholders. A call whose ticker has no price_bars -> all-NULL returns
    (counted, contributes to no cell), matching score_call's has_data=False."""
    rows = (await session.execute(
        _SCORE_SQL, {"cid": channel_id, "cutoff": cutoff, "bench": benchmark}
    )).all()
    calls: list[CallScore] = []
    for r in rows:
        stance = r.stance.value if hasattr(r.stance, "value") else r.stance
        calls.append(CallScore(
            video_id="", video_title="", ticker="", stance=stance,
            confidence=None, summary="", published_at="",
            returns={30: _f(r.ret_30), 90: _f(r.ret_90)},
            alpha={30: _f(r.alpha_30), 90: _f(r.alpha_90)},
            now_return=_f(r.ret_now),
            now_alpha=_f(r.alpha_now),
        ))
    return calls
