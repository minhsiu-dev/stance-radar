"""Holdings derivation: replay the transaction history -> per-ticker share count and weighted average cost.

Holdings are never persisted; a sell reduces the cost basis at the current average cost (the average cost stays unchanged).
"""
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Protocol, Sequence


class InvalidTransaction(ValueError):
    pass


class TransactionLike(Protocol):
    ticker: str
    side: object  # TransactionSide or str
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
    state: dict[str, tuple[Decimal, Decimal]] = {}  # ticker -> (shares, cost_basis)
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
