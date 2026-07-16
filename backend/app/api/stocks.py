import logging
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_market, get_price_store, get_session
from app.envelope import fail, ok
from app.insights.scorecard import PriceSeries, _to_series
from app.market.client import RANGE_TO_FETCH, MarketClient, StockNotFound
from app.market.store import PriceStore
from app.models import Channel, Mention, Video, VideoStance
from app.api.stance_buckets import bucket_channel_stances

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stocks")

_FINANCIAL_PERIODS = {"quarterly", "annual"}

# Daily-candle range -> number of calendar days to look back (ytd computed separately)
_DAILY_RANGE_DAYS = {"1m": 31, "3m": 93, "6m": 186, "1y": 366, "3y": 1096, "5y": 1827}
_INTRADAY_RANGES = {"1d", "5d"}


def daily_range_start(range_key: str, today: date) -> date:
    if range_key == "ytd":
        return date(today.year, 1, 1)
    return today - timedelta(days=_DAILY_RANGE_DAYS[range_key])


@router.get("")
async def list_stocks(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(Mention.ticker, func.count(Mention.id))
        .group_by(Mention.ticker)
        .order_by(func.count(Mention.id).desc(), Mention.ticker)
    )).all()
    return ok([{"ticker": t, "mention_count": c} for t, c in rows])


@router.get("/search")
async def stock_search(
    q: str = Query("", description="ticker or company name fragment"),
    market: MarketClient = Depends(get_market),
):
    if not q.strip():
        return fail("q must be non-empty", status_code=422)
    try:
        hits = await market.search(q.strip())
    except Exception:
        logger.exception("search failed for %s", q)
        return fail("Search temporarily unavailable, please try again later", status_code=502)
    return ok([asdict(h) for h in hits])


_TRENDING_HALF_LIFE_DAYS = 7.0


def _trending_item(ticker: str, entry: dict, now: datetime, span_days: int) -> dict:
    """Build a trending payload row. Channels are bucketed into their most-recent
    stance (within the count window). `last` is the newest mention in the count
    window, falling back to the freshness window when the count window is empty."""
    buckets_meta: dict[str, list[dict]] = {"buy": [], "neutral": [], "sell": []}
    for ch in entry["channels"].values():
        buckets_meta[ch["stance"]].append(ch)
    stances = {}
    for key, chans in buckets_meta.items():
        chans.sort(key=lambda c: c["last"], reverse=True)
        stances[key] = {
            "count": len(chans),
            "avatars": [
                {"title": c["title"], "thumbnail_url": c["thumbnail_url"]}
                for c in chans[:3]
            ],
        }
    last = entry["last"] or entry["fresh_last"]
    return {
        "ticker": ticker,
        "channel_count": len(entry["channels"]),
        "mention_count": entry["count"],
        "score": round(entry["score"], 4),
        "last_mentioned_at": last.isoformat(),
        "stances": stances,
        "buckets": bucket_channel_stances(entry["bucket_rows"], now, span_days),
    }


@router.get("/trending")
async def stocks_trending(
    limit: int = Query(12, ge=1, le=200),
    offset: int = Query(0, ge=0),
    days: int = Query(90, ge=1, le=365),
    count_days: int | None = Query(None, ge=1, le=365),
    min_channels: int | None = Query(None, ge=1),
    max_channels: int | None = Query(None, ge=1),
    session: AsyncSession = Depends(get_session),
):
    """`days` = freshness: only include stocks mentioned within this window.
    `count_days` (defaults to days) = the window for counting channels and stances.
    Sort key = distinct channel count -> most recent mention -> ticker.
    `min_channels`/`max_channels` (optional, inclusive) keep only tickers whose
    distinct-channel count falls within the band; applied after ranking and before
    pagination, so `offset`/`limit` page within the filtered set.
    `offset`/`limit` paginate the ranked list for infinite scroll."""
    now = datetime.now(timezone.utc)
    fresh_cutoff = now - timedelta(days=days)
    count_cutoff = now - timedelta(days=(count_days or days))
    earliest = min(fresh_cutoff, count_cutoff)
    rows = (await session.execute(
        select(
            Mention.ticker,
            Mention.stance,
            Video.channel_id,
            Channel.title,
            Channel.thumbnail_url,
            Video.published_at,
        )
        .join(Video, Mention.video_id == Video.id)
        .join(Channel, Video.channel_id == Channel.id)
        .where(Video.published_at >= earliest)
        .order_by(Video.published_at.asc(), Mention.id.asc())
    )).all()
    stats: dict[str, dict] = {}
    for ticker, stance, channel_id, ch_title, ch_thumb, published_at in rows:
        entry = stats.setdefault(
            ticker,
            {"count": 0, "score": 0.0, "last": None, "fresh_last": None,
             "channels": {}, "bucket_rows": []},
        )
        if published_at >= fresh_cutoff:
            entry["fresh_last"] = (
                published_at if entry["fresh_last"] is None
                else max(entry["fresh_last"], published_at)
            )
        if published_at >= count_cutoff:
            age_days = max((now - published_at).total_seconds() / 86400, 0.0)
            entry["count"] += 1
            entry["bucket_rows"].append((channel_id, stance.value, published_at))
            entry["score"] += 0.5 ** (age_days / _TRENDING_HALF_LIFE_DAYS)
            entry["last"] = (
                published_at if entry["last"] is None
                else max(entry["last"], published_at)
            )
            ch = entry["channels"].get(channel_id)
            if ch is None or published_at >= ch["last"]:
                entry["channels"][channel_id] = {
                    "title": ch_title,
                    "thumbnail_url": ch_thumb,
                    "stance": stance.value,
                    "last": published_at,
                }
    # only tickers that were mentioned within the freshness window
    fresh = [(t, e) for t, e in stats.items() if e["fresh_last"] is not None]
    fresh.sort(
        key=lambda te: (
            -len(te[1]["channels"]),
            -(te[1]["last"] or te[1]["fresh_last"]).timestamp(),
            te[0],
        ),
    )
    if min_channels is not None:
        fresh = [te for te in fresh if len(te[1]["channels"]) >= min_channels]
    if max_channels is not None:
        fresh = [te for te in fresh if len(te[1]["channels"]) <= max_channels]
    span = count_days or days
    return ok([_trending_item(t, e, now, span) for t, e in fresh[offset:offset + limit]])


@router.get("/{ticker}")
async def stock_summary(ticker: str, market: MarketClient = Depends(get_market)):
    try:
        summary = await market.get_summary(ticker.upper())
    except StockNotFound:
        return fail(f"No stock found: {ticker.upper()}", status_code=404)
    except Exception:
        logger.exception("summary fetch failed for %s", ticker)
        return fail("Market data temporarily unavailable, please try again later", status_code=502)
    return ok(asdict(summary))


@router.get("/{ticker}/financials")
async def stock_financials(
    ticker: str,
    period: str = Query("quarterly"),
    market: MarketClient = Depends(get_market),
):
    if period not in _FINANCIAL_PERIODS:
        return fail(
            f"period must be one of {', '.join(sorted(_FINANCIAL_PERIODS))}",
            status_code=422,
        )
    try:
        reports = await market.get_financials(ticker.upper(), period)  # type: ignore[arg-type]
    except StockNotFound:
        return fail(f"No stock found: {ticker.upper()}", status_code=404)
    except Exception:
        logger.exception("financials fetch failed for %s", ticker)
        return fail("Financial data temporarily unavailable, please try again later", status_code=502)
    return ok([asdict(r) for r in reports])


@router.get("/{ticker}/analyst")
async def stock_analyst(ticker: str, market: MarketClient = Depends(get_market)):
    try:
        data = await market.get_analyst(ticker.upper())
    except Exception:
        logger.exception("analyst fetch failed for %s", ticker)
        return fail("Analyst data temporarily unavailable, please try again later", status_code=502)
    return ok(asdict(data))


@router.get("/{ticker}/candles")
async def stock_candles(
    ticker: str,
    range_key: str = Query("1y", alias="range"),
    market: MarketClient = Depends(get_market),
    store: PriceStore = Depends(get_price_store),
):
    if range_key not in RANGE_TO_FETCH:
        return fail(
            f"range must be one of {', '.join(sorted(RANGE_TO_FETCH))}", status_code=422
        )
    t = ticker.upper()
    try:
        if range_key in _INTRADAY_RANGES:
            candles = await market.get_candles(t, range_key)
        else:
            today = datetime.now(timezone.utc).date()
            candles = (await store.get_daily([t], daily_range_start(range_key, today)))[t]
            if not candles:
                return fail(f"No stock found: {t}", status_code=404)
    except StockNotFound:
        return fail(f"No stock found: {t}", status_code=404)
    except Exception:
        logger.exception("candles fetch failed for %s", ticker)
        return fail("Market data temporarily unavailable, please try again later", status_code=502)
    return ok([asdict(c) for c in candles])


@router.get("/{ticker}/stance-summary")
async def stance_summary(
    ticker: str,
    days: int = Query(90, ge=1, le=3650),
    session: AsyncSession = Depends(get_session),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await session.execute(
        select(VideoStance.stance, func.count(Video.channel_id.distinct()))
        .join(Video, VideoStance.video_id == Video.id)
        .where(VideoStance.ticker == ticker.upper())
        .where(Video.published_at >= cutoff)
        .group_by(VideoStance.stance)
    )).all()
    counts = {"buy": 0, "neutral": 0, "sell": 0}
    for stance, c in rows:
        counts[stance.value] = c

    # Channels (deduplicated) that hold a stance on this ticker within the window, for showing avatars on the frontend
    chan_rows = (await session.execute(
        select(Channel.id, Channel.title, Channel.thumbnail_url)
        .join(Video, Video.channel_id == Channel.id)
        .join(VideoStance, VideoStance.video_id == Video.id)
        .where(VideoStance.ticker == ticker.upper())
        .where(Video.published_at >= cutoff)
        .distinct()
    )).all()
    channels = [
        {"id": cid, "title": title, "thumbnail_url": thumb}
        for cid, title, thumb in chan_rows
    ]

    # Per-bucket stance trend: distinct channels per bucket, by most-recent Mention stance.
    bucket_rows = (await session.execute(
        select(Video.channel_id, Mention.stance, Video.published_at)
        .join(Video, Mention.video_id == Video.id)
        .where(Mention.ticker == ticker.upper())
        .where(Video.published_at >= cutoff)
    )).all()
    rows_for_buckets = [(cid, st.value, pub) for cid, st, pub in bucket_rows]
    now = datetime.now(timezone.utc)
    if not rows_for_buckets:
        buckets = []
    elif days >= 3650:  # "All" -> span from the earliest matching mention
        earliest = min(pub for _, _, pub in rows_for_buckets)
        span = max(1, (now - earliest).days + 1)
        buckets = bucket_channel_stances(rows_for_buckets, now, span)
    else:
        buckets = bucket_channel_stances(rows_for_buckets, now, days)

    return ok({**counts, "window_days": days, "channels": channels, "buckets": buckets})


@router.get("/{ticker}/stances")
async def stock_stances(ticker: str, session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(VideoStance, Video, Channel)
        .join(Video, VideoStance.video_id == Video.id)
        .join(Channel, Video.channel_id == Channel.id)
        .where(VideoStance.ticker == ticker.upper())
        .order_by(Video.published_at.asc())  # chart markers need ascending time
    )).all()
    return ok([
        {
            "video_id": video.id,
            "video_title": video.title,
            "channel_id": channel.id,
            "channel_title": channel.title,
            "published_at": video.published_at.isoformat(),
            "stance": stance.stance.value,
            "summary": stance.summary,
            "confidence": stance.confidence,
        }
        for stance, video, channel in rows
    ])


def _majority_stance(mentions: list[Mention]) -> str:
    counts = {"buy": 0, "neutral": 0, "sell": 0}
    for m in mentions:
        counts[m.stance.value] += 1
    return max(counts, key=lambda k: counts[k])


@router.get("/{ticker}/mentions")
async def stock_mentions(
    ticker: str,
    session: AsyncSession = Depends(get_session),
    store: PriceStore = Depends(get_price_store),
):
    """One row per video: stance is the video's overall stance, timestamps list each mention."""
    t = ticker.upper()
    rows = (await session.execute(
        select(Mention, Video, Channel, VideoStance)
        .join(Video, Mention.video_id == Video.id)
        .join(Channel, Video.channel_id == Channel.id)
        .outerjoin(
            VideoStance,
            (VideoStance.video_id == Mention.video_id)
            & (VideoStance.ticker == Mention.ticker),
        )
        .where(Mention.ticker == t)
        .order_by(Video.published_at.desc(), Mention.start_seconds.asc())
    )).all()

    grouped: dict[str, dict] = {}
    video_mentions: dict[str, list[Mention]] = {}
    pub_dates: dict[str, date] = {}
    for mention, video, channel, video_stance in rows:
        if video.id not in grouped:
            pub_dates[video.id] = video.published_at.date()
            grouped[video.id] = {
                "video_id": video.id,
                "video_title": video.title,
                "channel_id": channel.id,
                "channel_title": channel.title,
                "channel_thumbnail": channel.thumbnail_url,
                "published_at": video.published_at.isoformat(),
                "stance": video_stance.stance.value if video_stance else None,
                "summary": video_stance.summary if video_stance else None,
                "confidence": video_stance.confidence if video_stance else None,
                "youtube_url": f"https://www.youtube.com/watch?v={video.id}",
                "mentions": [],
            }
            video_mentions[video.id] = []
        video_mentions[video.id].append(mention)
        grouped[video.id]["mentions"].append({
            "start_seconds": mention.start_seconds,
            "quote": mention.quote,
            "stance": mention.stance.value,
            "confidence": mention.confidence,
            "time_horizon": mention.time_horizon,
            "is_conditional": mention.is_conditional,
            "condition": mention.condition,
            "context_before": mention.context_before,
            "context_after": mention.context_after,
            "excerpt": mention.excerpt,
            "youtube_url": (
                f"https://www.youtube.com/watch?v={video.id}"
                f"&t={int(mention.start_seconds)}s"
            ),
        })

    # entry = closing price on the first trading day on/after the publish date,
    # the same definition the scorecard uses. Price lookup is best-effort: this
    # endpoint is otherwise pure DB, so a market-layer failure (e.g. yfinance
    # down) must not 500 the whole mentions table -- just serve null entries.
    series: PriceSeries | None = None
    if pub_dates:
        try:
            series = _to_series(
                (await store.get_daily([t], min(pub_dates.values()))).get(t, [])
            )
        except Exception:
            series = None
            logger.warning(
                "price lookup failed for %s, mentions served without entry prices",
                t, exc_info=True,
            )
    for vid, row in grouped.items():
        hit = series.close_on_or_after(pub_dates[vid]) if series else None
        row["entry_date"] = hit[0].isoformat() if hit else None
        row["entry_price"] = hit[1] if hit else None

    # Older data may lack a VideoStance -> backfill via majority vote over individual mentions
    result = [
        row if row["stance"] is not None
        else {**row, "stance": _majority_stance(video_mentions[row["video_id"]])}
        for row in grouped.values()
    ]
    return ok(result)
