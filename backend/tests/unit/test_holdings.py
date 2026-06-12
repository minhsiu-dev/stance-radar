from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.portfolio.holdings import InvalidTransaction, replay


@dataclass
class Tx:
    ticker: str
    side: str
    shares: Decimal
    price: Decimal
    executed_on: date
    created_at: datetime


_seq = 0


def tx(ticker, side, shares, price, executed_on):
    global _seq
    _seq += 1
    return Tx(
        ticker=ticker, side=side, shares=Decimal(shares), price=Decimal(price),
        executed_on=executed_on,
        created_at=datetime(2026, 1, 1, 0, 0, _seq % 60, tzinfo=timezone.utc),
    )


def test_buys_accumulate_weighted_average_cost():
    h = replay([
        tx("AAPL", "buy", "10", "100", date(2026, 1, 1)),
        tx("AAPL", "buy", "10", "200", date(2026, 2, 1)),
    ])
    assert h["AAPL"].shares == Decimal("20")
    assert h["AAPL"].avg_cost == Decimal("150")
    assert h["AAPL"].cost_basis == Decimal("3000")


def test_sell_reduces_shares_at_unchanged_avg_cost():
    h = replay([
        tx("AAPL", "buy", "10", "100", date(2026, 1, 1)),
        tx("AAPL", "buy", "10", "200", date(2026, 2, 1)),
        tx("AAPL", "sell", "5", "300", date(2026, 3, 1)),
    ])
    assert h["AAPL"].shares == Decimal("15")
    assert h["AAPL"].avg_cost == Decimal("150")


def test_fully_sold_position_is_dropped():
    h = replay([
        tx("AAPL", "buy", "10", "100", date(2026, 1, 1)),
        tx("AAPL", "sell", "10", "120", date(2026, 2, 1)),
    ])
    assert h == {}


def test_oversell_raises_with_ticker_and_date():
    with pytest.raises(InvalidTransaction) as exc:
        replay([
            tx("AAPL", "buy", "5", "100", date(2026, 1, 1)),
            tx("AAPL", "sell", "6", "100", date(2026, 2, 1)),
        ])
    assert "AAPL" in str(exc.value) and "2026-02-01" in str(exc.value)


def test_replay_orders_by_date_then_created_at():
    # 賣出在較早日期 → 即使 list 順序在後,重放時仍先驗到
    with pytest.raises(InvalidTransaction):
        replay([
            tx("AAPL", "buy", "5", "100", date(2026, 3, 1)),
            tx("AAPL", "sell", "5", "100", date(2026, 1, 1)),
        ])
