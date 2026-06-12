from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def create_engine_and_sessionmaker(
    database_url: str,
) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(database_url)
    maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return engine, maker
