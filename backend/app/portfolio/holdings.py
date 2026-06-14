"""持股推導:重放交易紀錄 → 每檔股數與加權平均成本。

持股永不落表;賣出按當下平均成本減少 cost basis(平均成本不變)。
"""
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Protocol, Sequence


class InvalidTransaction(ValueError):
    pass


class TransactionLike(Protocol):
    ticker: str
    side: object  # TransactionSide 或 str
    shares: Decimal
    price: Decimal
    executed_on: date
    created_at: datetime


@dataclass(frozen=True)
class Holding:
    ticker: str
    shares: Decimal
    avg_cost: Decimal
    cost_basis: Decimal


def _side_value(side: object) -> str:
    return side.value if hasattr(side, "value") else str(side)


def replay(transactions: Sequence[TransactionLike]) -> dict[str, Holding]:
    state: dict[str, tuple[Decimal, Decimal]] = {}  # ticker → (shares, cost_basis)
    ordered = sorted(transactions, key=lambda t: (t.executed_on, t.created_at))
    for t in ordered:
        shares, cost = state.get(t.ticker, (Decimal(0), Decimal(0)))
        if _side_value(t.side) == "buy":
            shares += t.shares
            cost += t.shares * t.price
        else:
            if t.shares > shares:
                raise InvalidTransaction(
                    f"{t.executed_on.isoformat()} sold {t.ticker} {t.shares} shares, "
                    f"but only {shares} held at the time"
                )
            avg = cost / shares
            shares -= t.shares
            cost -= avg * t.shares
        state[t.ticker] = (shares, cost)
    return {
        ticker: Holding(
            ticker=ticker, shares=shares,
            avg_cost=cost / shares, cost_basis=cost,
        )
        for ticker, (shares, cost) in state.items()
        if shares > 0
    }
