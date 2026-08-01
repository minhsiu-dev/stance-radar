"""頻道戰績走勢圖的資料層。

立場語意（與 ticker_perf.py 刻意不同）：方向性發言 carry-forward，neutral 完全
忽略。buy 之後一路算 buy，直到出現 sell 為止；neutral 既不開始也不結束區段，
同向重複發言也不切段。ticker_perf.py 那邊 neutral 是平倉，兩套並存於同一個 tab。
"""
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.market.store import PriceStore
from app.models import Stance, Video, VideoStance

logger = logging.getLogger(__name__)

TRACK_RECORD_TOP_N = 10
TRACK_RECORD_BENCHMARK = "VOO"
TRACK_RECORD_RANGES = ("6m", "1y", "all")
_RANGE_DAYS = {"6m": 182, "1y": 365}


@dataclass(frozen=True)
class Call:
    """一次方向性發言。stance 只會是 "buy" / "sell"（neutral 由呼叫端濾掉）。"""

    ticker: str
    stance: str
    day: date
    video_id: str
    video_title: str


def rank_tickers(calls: list[Call], top_n: int = TRACK_RECORD_TOP_N) -> list[str]:
    """前 N 支股票，依方向性發言次數 desc、ticker asc。全時間統計，不隨觀察窗改變，
    這樣切 range 時 chip 順序與配色都不會跳。"""
    counts: dict[str, int] = {}
    for call in calls:
        counts[call.ticker] = counts.get(call.ticker, 0) + 1
    return sorted(counts, key=lambda t: (-counts[t], t))[:top_n]


def build_runs(calls: list[Call], start: date) -> tuple[list[dict], list[dict]]:
    """把一支股票的方向性發言攤成 [start, today] 上的狀態區段 + 轉折 marker。

    `calls` 必須是同一支股票、依日期遞增、每天最多一筆（由 load_calls 收斂）。
    回傳 (runs, markers)：runs 首段的 from 恆等於 start、末段 to 為 None；相鄰段的
    to 與下一段的 from 是同一天（邊界日共用）。markers 只含窗內的轉折——窗起點之前
    的發言只用來決定首段的 carried state，不產生 marker。
    """
    state = "idle"
    transitions: list[Call] = []
    for call in calls:
        if call.stance != state:
            state = call.stance
            transitions.append(call)

    carried = "idle"
    for call in transitions:
        if call.day <= start:
            carried = call.stance
    in_window = [call for call in transitions if call.day > start]

    runs: list[dict] = [{"state": carried, "from": start.isoformat(), "to": None}]
    markers: list[dict] = []
    for call in in_window:
        runs[-1]["to"] = call.day.isoformat()
        runs.append({"state": call.stance, "from": call.day.isoformat(), "to": None})
        markers.append({
            "date": call.day.isoformat(),
            "stance": call.stance,
            "video_id": call.video_id,
            "video_title": call.video_title,
        })
    return runs, markers


async def load_calls(session: AsyncSession, channel_id: str) -> list[Call]:
    """該頻道所有方向性發言，收斂成每 (ticker, 日) 最多一筆——同一天多支影片時，
    published_at 最新的那支代表當天的立場。回傳依 (ticker, day) 遞增。"""
    rows = (await session.execute(
        select(
            VideoStance.ticker, VideoStance.stance,
            Video.published_at, Video.id, Video.title,
        )
        .join(Video, Video.id == VideoStance.video_id)
        .where(
            Video.channel_id == channel_id,
            VideoStance.stance != Stance.neutral,
        )
        .order_by(Video.published_at.asc(), Video.id.asc())
    )).all()
    by_key: dict[tuple[str, date], Call] = {}
    for ticker, stance, published_at, video_id, title in rows:
        day = published_at.astimezone(timezone.utc).date()
        by_key[(ticker, day)] = Call(
            ticker=ticker, stance=stance.value, day=day,
            video_id=video_id, video_title=title,
        )
    return sorted(by_key.values(), key=lambda c: (c.ticker, c.day))


async def build_track_record(
    session: AsyncSession, store: PriceStore, channel_id: str, range_key: str
) -> dict:
    """前十支股票的日線 + 立場區段 + 轉折 marker，外加 benchmark 序列。

    價格層失敗不得讓端點 500（比照 /api/stocks/sparklines）：例外時所有 closes
    降級為空陣列，立場區段照常回傳。"""
    calls = await load_calls(session, channel_id)
    tickers = rank_tickers(calls)
    chosen = set(tickers)
    selected = [c for c in calls if c.ticker in chosen]

    today = datetime.now(timezone.utc).date()
    if range_key == "all":
        start = min((c.day for c in selected), default=today)
    else:
        start = today - timedelta(days=_RANGE_DAYS[range_key])

    daily: dict[str, list] = {}
    if tickers:
        try:
            daily = await store.get_daily(
                sorted(chosen | {TRACK_RECORD_BENCHMARK}), start
            )
        except Exception:
            logger.exception("track-record price fetch failed for %s", channel_id)
            daily = {}

    def closes(ticker: str) -> list[dict]:
        return [{"date": c.time, "close": c.close} for c in daily.get(ticker, [])]

    items = []
    for ticker in tickers:
        ticker_calls = [c for c in selected if c.ticker == ticker]
        runs, markers = build_runs(ticker_calls, start)
        items.append({
            "ticker": ticker,
            "calls": len(ticker_calls),
            "runs": runs,
            "markers": markers,
            "closes": closes(ticker),
        })

    return {
        "benchmark": TRACK_RECORD_BENCHMARK,
        "range": range_key,
        "start": start.isoformat(),
        "benchmark_closes": closes(TRACK_RECORD_BENCHMARK),
        "tickers": items,
    }
