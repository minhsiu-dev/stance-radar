"""Per-ticker reversal-aware 個股戰績 performance vs VOO for one channel. Each directional
call is scored over [d, te] where te depends on the mode:
  - 'matured' (default): te = COALESCE(tc, today). Open calls <90d old are 'pending'
    (excluded from n/avg/win, counted). Exit = COALESCE(first close >= te, latest close).
  - 'incl': te = LEAST(d+90, COALESCE(tc, today)). All calls included (pending=0).
tc = next differing/neutral stance date on the same (channel, ticker), or NULL if open.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Reversal-aware per-ticker scoring. tc = next stance on (channel,ticker) after the call with a
# DIFFERENT stance (incl. neutral) -> the call's window ends there (closed); else the call is open
# and scored to today (mark-to-market) once >=90d old, otherwise pending. Exit close =
# COALESCE(first close >= te, latest close) so te=today resolves to the latest bar. close is double
# precision -> round() casts ::numeric; NULLIF guards the divisions. "today" is UTC to match call dates.
_TICKER_PERF_SQL = text("""
WITH all_stances AS (
    SELECT vs.ticker AS ticker, vs.stance AS stance,
           (v.published_at AT TIME ZONE 'UTC')::date AS d
    FROM video_stances vs
    JOIN videos v ON vs.video_id = v.id
    WHERE v.channel_id = :cid
),
calls AS (
    SELECT ticker, stance, d FROM all_stances WHERE stance <> 'neutral'
),
with_tc AS (
    SELECT c.ticker, c.stance, c.d,
        (SELECT MIN(a.d) FROM all_stances a
         WHERE a.ticker = c.ticker AND a.d > c.d AND a.stance <> c.stance) AS tc
    FROM calls c
),
with_te AS (
    SELECT ticker, stance, d, tc,
        CASE WHEN :mode = 'incl'
             THEN LEAST(d + 90, COALESCE(tc, (now() AT TIME ZONE 'UTC')::date))
             ELSE COALESCE(tc, (now() AT TIME ZONE 'UTC')::date)
        END AS te,
        CASE WHEN :mode = 'incl'
             THEN true
             ELSE (tc IS NOT NULL OR d + INTERVAL '90 day' <= (now() AT TIME ZONE 'UTC')::date)
        END AS matured
    FROM with_tc
),
scored AS (
    SELECT ticker, stance, matured,
        (SELECT pb.close FROM price_bars pb
         WHERE pb.ticker = w.ticker AND pb.date >= w.d
         ORDER BY pb.date LIMIT 1)                            AS entry,
        COALESCE(
            (SELECT pb.close FROM price_bars pb
             WHERE pb.ticker = w.ticker AND pb.date >= w.te
             ORDER BY pb.date LIMIT 1),
            (SELECT pb.close FROM price_bars pb
             WHERE pb.ticker = w.ticker
             ORDER BY pb.date DESC LIMIT 1)
        )                                                     AS exit_px,
        (SELECT pb.close FROM price_bars pb
         WHERE pb.ticker = 'VOO' AND pb.date >= w.d
         ORDER BY pb.date LIMIT 1)                            AS voo_e,
        COALESCE(
            (SELECT pb.close FROM price_bars pb
             WHERE pb.ticker = 'VOO' AND pb.date >= w.te
             ORDER BY pb.date LIMIT 1),
            (SELECT pb.close FROM price_bars pb
             WHERE pb.ticker = 'VOO'
             ORDER BY pb.date DESC LIMIT 1)
        )                                                     AS voo_l
    FROM with_te w
),
adj AS (
    SELECT ticker, stance, matured,
        (entry IS NOT NULL AND entry > 0 AND voo_e IS NOT NULL AND voo_e > 0
         AND exit_px IS NOT NULL AND voo_l IS NOT NULL)                       AS has_data,
        CASE WHEN stance = 'buy' THEN alpha ELSE -alpha END                   AS adjusted,
        CASE WHEN stance = 'buy' THEN ret   ELSE -ret   END                   AS adjusted_return
    FROM (
        SELECT ticker, stance, matured, entry, exit_px, voo_e, voo_l,
            round(
                round((((exit_px / NULLIF(entry, 0)) - 1) * 100)::numeric, 2)
                - round((((voo_l / NULLIF(voo_e, 0)) - 1) * 100)::numeric, 2),
                2
            ) AS alpha,
            round((((exit_px / NULLIF(entry, 0)) - 1) * 100)::numeric, 2) AS ret
        FROM scored
    ) s
),
agg AS (
    SELECT ticker,
        count(*) FILTER (WHERE matured AND has_data)                          AS n_all,
        round(avg(adjusted) FILTER (WHERE matured AND has_data), 2)           AS avg_alpha_all,
        round(avg(adjusted_return) FILTER (WHERE matured AND has_data), 2)    AS avg_return_all,
        round(100.0 * count(*) FILTER (WHERE matured AND has_data AND adjusted > 0)
              / NULLIF(count(*) FILTER (WHERE matured AND has_data), 0), 1)   AS win_rate_all,
        count(*) FILTER (WHERE NOT matured)                                   AS pending_all,
        count(*) FILTER (WHERE matured AND has_data AND stance = 'buy')       AS n_buy,
        round(avg(adjusted) FILTER (WHERE matured AND has_data AND stance = 'buy'), 2)        AS avg_alpha_buy,
        round(avg(adjusted_return) FILTER (WHERE matured AND has_data AND stance = 'buy'), 2) AS avg_return_buy,
        round(100.0 * count(*) FILTER (WHERE matured AND has_data AND stance = 'buy' AND adjusted > 0)
              / NULLIF(count(*) FILTER (WHERE matured AND has_data AND stance = 'buy'), 0), 1) AS win_rate_buy,
        count(*) FILTER (WHERE NOT matured AND stance = 'buy')                AS pending_buy,
        count(*) FILTER (WHERE matured AND has_data AND stance = 'sell')      AS n_sell,
        round(avg(adjusted) FILTER (WHERE matured AND has_data AND stance = 'sell'), 2)        AS avg_alpha_sell,
        round(avg(adjusted_return) FILTER (WHERE matured AND has_data AND stance = 'sell'), 2) AS avg_return_sell,
        round(100.0 * count(*) FILTER (WHERE matured AND has_data AND stance = 'sell' AND adjusted > 0)
              / NULLIF(count(*) FILTER (WHERE matured AND has_data AND stance = 'sell'), 0), 1) AS win_rate_sell,
        count(*) FILTER (WHERE NOT matured AND stance = 'sell')               AS pending_sell
    FROM adj
    GROUP BY ticker
)
SELECT * FROM agg
""")


def _slice(row, s: str) -> dict:
    n = getattr(row, f"n_{s}")
    aa = getattr(row, f"avg_alpha_{s}")
    ar = getattr(row, f"avg_return_{s}")
    wr = getattr(row, f"win_rate_{s}")
    pend = getattr(row, f"pending_{s}")
    return {
        "n": int(n),
        "avg_alpha": float(aa) if aa is not None else None,
        "avg_return": float(ar) if ar is not None else None,
        "win_rate": float(wr) if wr is not None else None,
        "pending": int(pend),
    }


async def channel_ticker_performance(
    session: AsyncSession, channel_id: str, mode: str = "matured"
) -> dict[str, dict]:
    """{ticker: {"all"|"buy"|"sell": {n, avg_alpha, avg_return, win_rate, pending}}}.
    mode='matured' (default): te = COALESCE(tc, today); open calls <90d old are pending
    (excluded from n/avg/win, counted in pending). win = adjusted alpha > 0 strict, vs VOO.
    mode='incl': te = LEAST(d+90, COALESCE(tc, today)) for every call (no pending, all counted)."""
    rows = (await session.execute(
        _TICKER_PERF_SQL, {"cid": channel_id, "mode": mode}
    )).all()
    return {
        r.ticker: {s: _slice(r, s) for s in ("all", "buy", "sell")}
        for r in rows
    }
