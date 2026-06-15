from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PortfolioCash


async def get_cash(session: AsyncSession) -> Decimal:
    row = (await session.execute(
        select(PortfolioCash).where(PortfolioCash.id == 1)
    )).scalar_one_or_none()
    return row.amount if row is not None else Decimal(0)


async def set_cash(session: AsyncSession, amount: Decimal) -> None:
    row = await session.get(PortfolioCash, 1)
    if row is None:
        session.add(PortfolioCash(id=1, amount=amount))
    else:
        row.amount = amount
    await session.commit()
