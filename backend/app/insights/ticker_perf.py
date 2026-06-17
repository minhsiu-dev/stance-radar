"""Per-ticker all-time 至今 performance vs VOO for one channel, computed with
indexed (ticker, date) lookups on price_bars instead of loading full price series
into Python. Mirrors score_call's now_alpha semantics so the two paths agree
(see tests/unit/test_ticker_perf.py::test_channel_ticker_performance_matches_score_call).
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Directional calls (stance != neutral), each scored 至今 vs VOO via (ticker,date) index seeks.
# adj carries both the stance-adjusted alpha (vs VOO) and the stance-adjusted RAW return; the final
# SELECT emits all/buy/sell slices via FILTER. close is double precision -> round() casts to numeric.
# published_at cast in UTC to match Python datetime.date() / score_call.
_TICKER_PERF_SQL = text("""
WITH calls AS (
    SELECT vs.ticker AS ticker, vs.stance AS stance,
           (v.published_at AT TIME ZONE 'UTC')::date AS d
    FROM video_stances vs
    JOIN videos v ON vs.video_id = v.id
    WHERE v.channel_id = :cid AND vs.stance <> 'neutral'
),
scored AS (
    SELECT c.ticker AS ticker, c.stance AS stance,
        (SELECT pb.close FROM price_bars pb
         WHERE pb.ticker = c.ticker AND pb.date >= c.d
         ORDER BY pb.date LIMIT 1)               AS entry,
        (SELECT pb.close FROM price_bars pb
         WHERE pb.ticker = c.ticker
         ORDER BY pb.date DESC LIMIT 1)          AS latest,
        (SELECT pb.close FROM price_bars pb
         WHERE pb.ticker = 'VOO' AND pb.date >= c.d
         ORDER BY pb.date LIMIT 1)               AS voo_e,
        (SELECT pb.close FROM price_bars pb
         WHERE pb.ticker = 'VOO'
         ORDER BY pb.date DESC LIMIT 1)          AS voo_l
    FROM calls c
),
adj AS (
    SELECT ticker, stance,
        CASE WHEN stance = 'buy' THEN a ELSE -a END AS adjusted,
        CASE WHEN stance = 'buy' THEN r ELSE -r END AS adjusted_return
    FROM (
        SELECT ticker, stance,
            round(
                round((((latest / entry) - 1) * 100)::numeric, 2)
                - round((((voo_l / voo_e) - 1) * 100)::numeric, 2),
                2
            ) AS a,
            round((((latest / entry) - 1) * 100)::numeric, 2) AS r
        FROM scored
        WHERE entry > 0 AND voo_e > 0 AND latest IS NOT NULL AND voo_l IS NOT NULL
    ) s
)
SELECT ticker,
    count(*)                                                          AS n_all,
    round(avg(adjusted), 2)                                           AS avg_alpha_all,
    round(avg(adjusted_return), 2)                                    AS avg_return_all,
    round(100.0 * count(*) FILTER (WHERE adjusted > 0) / count(*), 1) AS win_rate_all,
    count(*) FILTER (WHERE stance = 'buy')                            AS n_buy,
    round(avg(adjusted) FILTER (WHERE stance = 'buy'), 2)            AS avg_alpha_buy,
    round(avg(adjusted_return) FILTER (WHERE stance = 'buy'), 2)     AS avg_return_buy,
    round(100.0 * count(*) FILTER (WHERE stance = 'buy' AND adjusted > 0)
          / NULLIF(count(*) FILTER (WHERE stance = 'buy'), 0), 1)    AS win_rate_buy,
    count(*) FILTER (WHERE stance = 'sell')                          AS n_sell,
    round(avg(adjusted) FILTER (WHERE stance = 'sell'), 2)           AS avg_alpha_sell,
    round(avg(adjusted_return) FILTER (WHERE stance = 'sell'), 2)    AS avg_return_sell,
    round(100.0 * count(*) FILTER (WHERE stance = 'sell' AND adjusted > 0)
          / NULLIF(count(*) FILTER (WHERE stance = 'sell'), 0), 1)   AS win_rate_sell
FROM adj
GROUP BY ticker
""")


def _slice(row, s: str) -> dict:
    n = getattr(row, f"n_{s}")
    aa = getattr(row, f"avg_alpha_{s}")
    ar = getattr(row, f"avg_return_{s}")
    wr = getattr(row, f"win_rate_{s}")
    return {
        "n": int(n),
        "avg_alpha": float(aa) if aa is not None else None,
        "avg_return": float(ar) if ar is not None else None,
        "win_rate": float(wr) if wr is not None else None,
    }


async def channel_ticker_performance(
    session: AsyncSession, channel_id: str
) -> dict[str, dict]:
    """{ticker: {"all"|"buy"|"sell": {n, avg_alpha, avg_return, win_rate}}} for every ticker
    with >=1 realized directional call. all = both stances; buy/sell = that stance's calls
    (n=0 / null cells when the ticker has no calls of that stance). Tickers with no usable
    price data are absent (caller fills the empty slices). Matches score_call's now_alpha /
    _adjusted_return semantics (win = adjusted alpha > 0 strict)."""
    rows = (await session.execute(_TICKER_PERF_SQL, {"cid": channel_id})).all()
    return {
        r.ticker: {s: _slice(r, s) for s in ("all", "buy", "sell")}
        for r in rows
    }
