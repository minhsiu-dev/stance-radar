from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from app.market.store import FetchPlan, plan_fetches

TODAY = date(2026, 6, 12)
NOW = datetime(2026, 6, 12, 12, 0, tzinfo=timezone.utc)
START = date(2025, 6, 12)


@dataclass
class Cov:
    start_date: date
    end_date: date
    last_synced_at: datetime


def test_uncovered_ticker_needs_full_fetch():
    plan = plan_fetches({}, ["AAPL"], START, TODAY, NOW)
    assert plan == FetchPlan(full={"AAPL": START}, trailing={})


def test_leading_gap_triggers_full_refetch():
    cov = {"AAPL": Cov(date(2026, 1, 1), TODAY, NOW)}
    plan = plan_fetches(cov, ["AAPL"], START, TODAY, NOW)
    assert plan.full == {"AAPL": START}
    assert plan.trailing == {}


def test_stale_tail_triggers_trailing_fetch_with_overlap():
    cov = {"AAPL": Cov(START, date(2026, 6, 10), NOW - timedelta(hours=2))}
    plan = plan_fetches(cov, ["AAPL"], START, TODAY, NOW)
    assert plan.full == {}
    assert plan.trailing == {"AAPL": date(2026, 6, 10) - timedelta(days=7)}


def test_recent_sync_skips_trailing_fetch():
    cov = {"AAPL": Cov(START, date(2026, 6, 10), NOW - timedelta(minutes=10))}
    plan = plan_fetches(cov, ["AAPL"], START, TODAY, NOW)
    assert plan == FetchPlan(full={}, trailing={})


def test_fully_covered_ticker_needs_nothing():
    cov = {"AAPL": Cov(START, TODAY, NOW - timedelta(days=3))}
    plan = plan_fetches(cov, ["AAPL"], START, TODAY, NOW)
    assert plan == FetchPlan(full={}, trailing={})
