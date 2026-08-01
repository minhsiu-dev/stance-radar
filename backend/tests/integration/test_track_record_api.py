from datetime import datetime, timedelta, timezone

import pytest

from app.models import Channel, Stance, Video, VideoStance, VideoStatus

pytestmark = pytest.mark.asyncio

_NOW = datetime.now(timezone.utc)


async def seed(sessionmaker, rows) -> None:
    """rows: (video_id, days_ago, ticker, stance)"""
    async with sessionmaker() as s:
        s.add(Channel(
            id="ch1", title="頻道一", thumbnail_url="", uploads_playlist_id="UU1",
        ))
        for vid, ago, ticker, stance in rows:
            if await s.get(Video, vid) is None:
                s.add(Video(
                    id=vid, channel_id="ch1", title=f"title {vid}",
                    published_at=_NOW - timedelta(days=ago),
                    thumbnail_url="", duration_seconds=60,
                    status=VideoStatus.analyzed,
                ))
            s.add(VideoStance(video_id=vid, ticker=ticker, stance=stance, summary="s"))
        await s.commit()


_ROWS = [
    # AAPL (not the placeholder "AAA") because FakeMarketClient only has fake
    # price data for its KNOWN tickers -- this fixture's price-series assertions
    # need a real hit, unlike ticker_perf.py's tests which seed PriceBar rows
    # directly and can use any placeholder ticker.
    ("v1", 300, "AAPL", Stance.buy),
    ("v2", 200, "AAPL", Stance.buy),      # 同向重複
    ("v3", 100, "AAPL", Stance.sell),     # 反轉
    ("v4", 250, "BBB", Stance.buy),
    ("v5", 150, "BBB", Stance.neutral),  # 忽略
    ("v6", 50, "CCC", Stance.neutral),   # CCC 完全沒有方向性發言
]


async def test_track_record_unknown_channel_404(api):
    _, client = api
    resp = await client.get("/api/channels/nope/track-record")
    assert resp.status_code == 404


async def test_track_record_invalid_range_422(api, sessionmaker):
    _, client = api
    await seed(sessionmaker, _ROWS)
    resp = await client.get("/api/channels/ch1/track-record?range=7d")
    assert resp.status_code == 422


async def test_track_record_shape_and_carry_forward(api, sessionmaker):
    _, client = api
    await seed(sessionmaker, _ROWS)
    resp = await client.get("/api/channels/ch1/track-record?range=all")
    assert resp.status_code == 200
    data = resp.json()["data"]

    assert data["benchmark"] == "VOO"
    assert data["range"] == "all"
    # neutral-only 的 CCC 不入選；AAPL 3 次方向性、BBB 1 次
    assert [t["ticker"] for t in data["tickers"]] == ["AAPL", "BBB"]
    assert [t["calls"] for t in data["tickers"]] == [3, 1]

    aaa = data["tickers"][0]
    # range=all 的起點 = 最早一次方向性發言 -> 首段直接是 buy，沒有 idle 前置段
    assert aaa["runs"][0]["state"] == "buy"
    assert aaa["runs"][0]["from"] == data["start"]
    assert [r["state"] for r in aaa["runs"]] == ["buy", "sell"]
    assert aaa["runs"][-1]["to"] is None
    # 相鄰段共用邊界日
    assert aaa["runs"][0]["to"] == aaa["runs"][1]["from"]
    # 同向重複的 v2 不產生 marker；起點上的 v1 也不產生
    assert [m["video_id"] for m in aaa["markers"]] == ["v3"]
    assert aaa["markers"][0]["stance"] == "sell"

    # BBB 唯一的方向性發言(v4, 250天前)晚於全頻道最早發言(AAPL 的 v1, 300天前) ->
    # 共用的全域 start 落在 BBB 被提及之前，所以 BBB 也有一段 idle 前導才轉 buy；
    # neutral 的 v5 在 load_calls 階段就被濾掉，不影響、也不切段。
    bbb = data["tickers"][1]
    assert [r["state"] for r in bbb["runs"]] == ["idle", "buy"]
    assert bbb["runs"][0]["from"] == data["start"]
    assert bbb["runs"][-1]["to"] is None
    assert [m["video_id"] for m in bbb["markers"]] == ["v4"]

    # FakeMarketClient 有價格 -> 收盤序列非空且欄位正確
    assert data["benchmark_closes"]
    assert set(data["benchmark_closes"][0]) == {"date", "close"}
    assert aaa["closes"]


async def test_track_record_window_start_carries_state(api, sessionmaker):
    _, client = api
    # 唯一一次 buy 在 300 天前 -> 6m 窗內沒有任何發言，但首段必須已經是 buy
    await seed(sessionmaker, [("v1", 300, "AAA", Stance.buy)])
    data = (await client.get(
        "/api/channels/ch1/track-record?range=6m"
    )).json()["data"]
    aaa = data["tickers"][0]
    assert [r["state"] for r in aaa["runs"]] == ["buy"]
    assert aaa["runs"][0]["from"] == data["start"]
    assert aaa["markers"] == []


async def test_track_record_neutral_only_channel_is_empty(api, sessionmaker):
    _, client = api
    await seed(sessionmaker, [("v6", 10, "CCC", Stance.neutral)])
    resp = await client.get("/api/channels/ch1/track-record")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["tickers"] == []
    assert data["benchmark_closes"] == []


async def test_track_record_price_failure_degrades_to_empty_closes(
    api, sessionmaker, monkeypatch,
):
    app, client = api
    await seed(sessionmaker, _ROWS)

    async def boom(tickers, start):
        raise RuntimeError("yfinance down")

    monkeypatch.setattr(app.state.price_store, "get_daily", boom)
    resp = await client.get("/api/channels/ch1/track-record")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["benchmark_closes"] == []
    assert [t["ticker"] for t in data["tickers"]] == ["AAPL", "BBB"]
    assert all(t["closes"] == [] for t in data["tickers"])
    # 價格掛了不影響立場區段
    assert data["tickers"][0]["runs"]


async def test_track_record_defaults_to_1y(api, sessionmaker):
    _, client = api
    await seed(sessionmaker, _ROWS)
    data = (await client.get("/api/channels/ch1/track-record")).json()["data"]
    assert data["range"] == "1y"
