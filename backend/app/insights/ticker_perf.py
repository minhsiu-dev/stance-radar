"""Per-ticker all-time 至今 performance vs VOO for one channel, computed with
indexed (ticker, date) lookups on price_bars instead of loading full price series
into Python. Mirrors score_call's now_alpha semantics so the two paths agree
(see tests/unit/test_ticker_perf.py::test_channel_ticker_performance_matches_score_call).
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Directional calls (stance != neutral) for the channel, each scored 至今 (entry close
# -> latest close) vs VOO over the same window. Each leg is an index seek on the
# (ticker, date) PK. price_bars.close is double precision, so every round() casts to
# numeric first. published_at is cast in UTC to match Python's datetime.date().
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
    SELECT ticker,
        CASE WHEN stance = 'buy' THEN a ELSE -a END AS adjusted
    FROM (
        SELECT ticker, stance,
            round(
                round((((latest / entry) - 1) * 100)::numeric, 2)
                - round((((voo_l / voo_e) - 1) * 100)::numeric, 2),
                2
            ) AS a
        FROM scored
        WHERE entry > 0 AND voo_e > 0 AND latest IS NOT NULL AND voo_l IS NOT NULL
    ) s
)
SELECT ticker,
    count(*)                                                          AS n,
    round(avg(adjusted), 2)                                           AS avg_alpha,
    round(100.0 * count(*) FILTER (WHERE adjusted > 0) / count(*), 1) AS win_rate
FROM adj
GROUP BY ticker
""")


async def channel_ticker_performance(
    session: AsyncSession, channel_id: str
) -> dict[str, dict]:
    """{ticker: {"n": int, "avg_alpha": float, "win_rate": float}} for every ticker
    the channel has at least one realized directional call on. Tickers with only
    neutral mentions, or no usable price data, are simply absent (the caller
    left-joins them back as n=0 / null)."""
    rows = (await session.execute(_TICKER_PERF_SQL, {"cid": channel_id})).all()
    return {
        r.ticker: {
            "n": int(r.n),
            "avg_alpha": float(r.avg_alpha) if r.avg_alpha is not None else None,
            "win_rate": float(r.win_rate) if r.win_rate is not None else None,
        }
        for r in rows
    }
