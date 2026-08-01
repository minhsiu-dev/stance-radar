from datetime import date

import pytest

from app.insights.track_record import Call, build_runs, rank_tickers

pytestmark = pytest.mark.asyncio


def c(ticker: str, stance: str, day: str, vid: str = "v") -> Call:
    return Call(
        ticker=ticker,
        stance=stance,
        day=date.fromisoformat(day),
        video_id=vid,
        video_title=f"t {vid}",
    )


def states(runs: list[dict]) -> list[tuple[str, str, str | None]]:
    return [(r["state"], r["from"], r["to"]) for r in runs]


def test_rank_tickers_orders_by_directional_count_then_ticker():
    calls = [
        c("AAA", "buy", "2026-01-01"), c("AAA", "buy", "2026-02-01"),
        c("BBB", "sell", "2026-01-05"), c("BBB", "buy", "2026-02-05"),
        c("CCC", "buy", "2026-01-09"),
        c("DDD", "buy", "2026-01-09"),
    ]
    # AAA/BBB 各 2 次 -> 依 ticker 升冪；CCC/DDD 各 1 次 -> CCC 先
    assert rank_tickers(calls, top_n=3) == ["AAA", "BBB", "CCC"]


def test_rank_tickers_caps_at_top_n():
    calls = [c(f"T{i:02d}", "buy", "2026-01-01") for i in range(15)]
    assert len(rank_tickers(calls)) == 10


def test_build_runs_repeat_same_stance_does_not_split():
    calls = [c("AAA", "buy", "2026-01-10"), c("AAA", "buy", "2026-03-10")]
    runs, markers = build_runs(calls, date(2026, 1, 1))
    assert states(runs) == [
        ("idle", "2026-01-01", "2026-01-10"),
        ("buy", "2026-01-10", None),
    ]
    assert [m["date"] for m in markers] == ["2026-01-10"]


def test_build_runs_splits_only_on_reversal():
    calls = [
        c("AAA", "buy", "2026-01-10", "v1"),
        c("AAA", "buy", "2026-02-10", "v2"),
        c("AAA", "sell", "2026-03-10", "v3"),
        c("AAA", "buy", "2026-04-10", "v4"),
    ]
    runs, markers = build_runs(calls, date(2026, 1, 1))
    assert states(runs) == [
        ("idle", "2026-01-01", "2026-01-10"),
        ("buy", "2026-01-10", "2026-03-10"),
        ("sell", "2026-03-10", "2026-04-10"),
        ("buy", "2026-04-10", None),
    ]
    # v2 是同向重複 -> 不產生 marker
    assert [m["video_id"] for m in markers] == ["v1", "v3", "v4"]
    assert markers[1] == {
        "date": "2026-03-10", "stance": "sell",
        "video_id": "v3", "video_title": "t v3",
    }


def test_build_runs_carries_state_into_a_window_that_starts_mid_run():
    calls = [c("AAA", "buy", "2025-06-01", "v1"), c("AAA", "sell", "2026-05-01", "v2")]
    runs, markers = build_runs(calls, date(2026, 1, 1))
    assert states(runs) == [
        ("buy", "2026-01-01", "2026-05-01"),
        ("sell", "2026-05-01", None),
    ]
    # 窗外的那次 buy 不產生 marker，只有窗內的反轉才有
    assert [m["video_id"] for m in markers] == ["v2"]


def test_build_runs_with_no_calls_is_a_single_idle_run():
    runs, markers = build_runs([], date(2026, 1, 1))
    assert states(runs) == [("idle", "2026-01-01", None)]
    assert markers == []


def test_build_runs_transition_exactly_on_start_is_carried_not_marked():
    calls = [c("AAA", "buy", "2026-01-01", "v1")]
    runs, markers = build_runs(calls, date(2026, 1, 1))
    assert states(runs) == [("buy", "2026-01-01", None)]
    assert markers == []
