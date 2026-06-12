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
        user="stance", password="stance", database="postgres",
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


@pytest.fixture
async def sessionmaker(engine):
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def api(engine, monkeypatch):
    """(app, client) — fake adapters + test db 的完整 ASGI app。"""
    monkeypatch.setenv("USE_FAKE_ADAPTERS", "true")
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    from app.config import get_settings

    get_settings.cache_clear()
    from asgi_lifespan import LifespanManager
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app

    app = create_app()
    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield app, client
    get_settings.cache_clear()


async def wait_refresh(app) -> None:
    """等待背景 refresh job 完成(測試輔助)。"""
    runner = app.state.runner
    if runner.current_task is not None:
        await runner.current_task
