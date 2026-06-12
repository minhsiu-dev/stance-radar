import os

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://stance:stance@localhost:5432/stance_radar_test",
)


async def _ensure_test_database() -> None:
    conn = await asyncpg.connect(
        user="stance", password="stance", database="stance_radar",
        host="localhost", port=5432,
    )
    try:
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = 'stance_radar_test'"
        )
        if not exists:
            await conn.execute("CREATE DATABASE stance_radar_test")
    finally:
        await conn.close()


@pytest.fixture
async def engine():
    await _ensure_test_database()
    from app.db import Base
    from app import models  # noqa: F401  # 註冊 models

    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
async def session(engine) -> AsyncSession:
    maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with maker() as s:
        yield s
