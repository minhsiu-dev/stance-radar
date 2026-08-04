from datetime import date

from app.insights.track_record import (
    Call, build_runs, call_counts, parse_ticker_param, resolve_selection,
)


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


def test_call_counts_orders_by_count_desc_then_ticker_asc():
    calls = [
        c("AAA", "buy", "2026-01-01"), c("AAA", "buy", "2026-02-01"),
        c("BBB", "sell", "2026-01-05"), c("BBB", "buy", "2026-02-05"),
        c("CCC", "buy", "2026-01-09"),
        c("DDD", "buy", "2026-01-09"),
    ]
    # 這正是線上 AMD(10) / PLTR(10) 同票數的情況：字母序決勝，且兩者都必須留在清單裡
    assert call_counts(calls) == [("AAA", 2), ("BBB", 2), ("CCC", 1), ("DDD", 1)]


def test_call_counts_lists_every_ticker_not_just_the_top_ten():
    calls = [c(f"T{i:02d}", "buy", "2026-01-01") for i in range(15)]
    assert len(call_counts(calls)) == 15


def test_build_runs_repeat_same_stance_does_not_split():
    calls = [c("AAA", "buy", "2026-01-10"), c("AAA", "buy", "2026-03-10")]
    runs, markers = build_runs(calls, date(2026, 1, 1))
    assert states(runs) == [
        ("idle", "2026-01-01", "2026-01-10"),
        ("buy", "2026-01-10", None),
    ]
    # 不切段,但兩次發言都要有 marker(第二次標成 repeat)
    assert [(m["date"], m["kind"]) for m in markers] == [
        ("2026-01-10", "new"),
        ("2026-03-10", "repeat"),
    ]


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
    # v2 是同向重複 -> 不切段,但仍然有 marker,只是 kind=repeat
    assert [(m["video_id"], m["kind"]) for m in markers] == [
        ("v1", "new"), ("v2", "repeat"), ("v3", "new"), ("v4", "new"),
    ]
    assert markers[2] == {
        "date": "2026-03-10", "stance": "sell", "kind": "new",
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


def test_build_runs_repeat_before_the_window_start_does_not_leak_in():
    # v1 首次表態、v2 同向重申,兩者都在窗外;只有窗內的 v3 該出現
    calls = [
        c("AAA", "buy", "2025-06-01", "v1"),
        c("AAA", "buy", "2025-09-01", "v2"),
        c("AAA", "buy", "2026-03-01", "v3"),
    ]
    runs, markers = build_runs(calls, date(2026, 1, 1))
    assert states(runs) == [("buy", "2026-01-01", None)]
    assert [(m["video_id"], m["kind"]) for m in markers] == [("v3", "repeat")]


def test_build_runs_with_no_calls_is_a_single_idle_run():
    runs, markers = build_runs([], date(2026, 1, 1))
    assert states(runs) == [("idle", "2026-01-01", None)]
    assert markers == []


def test_build_runs_transition_exactly_on_start_is_carried_not_marked():
    calls = [c("AAA", "buy", "2026-01-01", "v1")]
    runs, markers = build_runs(calls, date(2026, 1, 1))
    assert states(runs) == [("buy", "2026-01-01", None)]
    assert markers == []


def test_build_runs_reports_the_true_open_date_of_a_carried_position():
    # 進場在窗外 300 天前 -> runs[0].from 被裁到窗起點,但 opened_at 要保留真實進場日
    calls = [c("AAA", "buy", "2025-06-01", "v1"), c("AAA", "sell", "2026-05-01", "v2")]
    runs, _ = build_runs(calls, date(2026, 1, 1))
    assert [(r["from"], r["opened_at"]) for r in runs] == [
        ("2026-01-01", "2025-06-01"),   # 裁切過的 from vs 真實進場日
        ("2026-05-01", "2026-05-01"),   # 窗內開的倉,兩者相同
    ]


def test_build_runs_idle_run_has_no_open_date():
    calls = [c("AAA", "buy", "2026-03-01", "v1")]
    runs, _ = build_runs(calls, date(2026, 1, 1))
    assert [(r["state"], r["opened_at"]) for r in runs] == [
        ("idle", None),
        ("buy", "2026-03-01"),
    ]


def test_build_runs_repeat_does_not_move_the_open_date():
    # 同向重申不開新倉 -> opened_at 仍是第一次 buy 的日期
    calls = [
        c("AAA", "buy", "2026-02-01", "v1"),
        c("AAA", "buy", "2026-04-01", "v2"),
    ]
    runs, _ = build_runs(calls, date(2026, 1, 1))
    assert runs[-1]["opened_at"] == "2026-02-01"


def test_parse_ticker_param_normalises_and_dedupes():
    assert parse_ticker_param(" nvda , mu ,NVDA ") == ["NVDA", "MU"]


def test_parse_ticker_param_treats_blank_as_absent():
    assert parse_ticker_param(None) is None
    assert parse_ticker_param("") is None
    assert parse_ticker_param(" , , ") is None


def test_resolve_selection_defaults_to_the_top_five():
    counts = [(f"T{i:02d}", 20 - i) for i in range(8)]
    assert resolve_selection(counts, None) == ["T00", "T01", "T02", "T03", "T04"]


def test_resolve_selection_returns_rank_order_not_request_order():
    counts = [("AAA", 3), ("BBB", 2), ("CCC", 1)]
    # 請求順序是 CCC, AAA -> 回應仍照排名 AAA, CCC,回應才具決定性
    assert resolve_selection(counts, ["CCC", "AAA"]) == ["AAA", "CCC"]


def test_resolve_selection_drops_unknown_tickers_silently():
    counts = [("AAA", 3), ("BBB", 2)]
    # 舊書籤裡有頻道已不再提及的股票時,照常畫出剩下的比噴 422 有用
    assert resolve_selection(counts, ["BBB", "ZZZ"]) == ["BBB"]


def test_resolve_selection_truncates_to_the_max():
    counts = [(f"T{i:02d}", 20 - i) for i in range(15)]
    assert resolve_selection(counts, [t for t, _ in counts]) == [
        f"T{i:02d}" for i in range(10)
    ]


def test_resolve_selection_falls_back_to_default_when_nothing_valid_remains():
    counts = [("AAA", 3), ("BBB", 2)]
    assert resolve_selection(counts, ["ZZZ"]) == ["AAA", "BBB"]


def test_resolve_selection_on_an_empty_channel_is_empty():
    assert resolve_selection([], ["AAA"]) == []
