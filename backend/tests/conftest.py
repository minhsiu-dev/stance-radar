import os
from urllib.parse import urlsplit

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://stance:stance@localhost:5432/stance_radar_test",
)
_DB = urlsplit(TEST_DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://"))


async def _ensure_test_database() -> None:
    conn = await asyncpg.connect(
        user=_DB.username, password=_DB.password, database="postgres",
        host=_DB.hostname, port=_DB.port or 5432,
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
    from app import models  # noqa: F401  # register models

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
    """(app, client) — full ASGI app with fake adapters + test db, admin UNLOCKED."""
    monkeypatch.setenv("USE_FAKE_ADAPTERS", "true")
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("ADMIN_PASSWORD", "hunter2")
    from app.config import get_settings

    get_settings.cache_clear()
    from asgi_lifespan import LifespanManager
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app
    from app.worker import JobWorker

    app = create_app()
    async with LifespanManager(app):
        # Production splits job *running* into a separate `worker` container that claims
        # rows via JobWorker.poll_once() (see app/worker.py); api routes only enqueue() an
        # unclaimed row now. One JobWorker for the whole fixture lifetime -- same as the
        # real worker process holds exactly one across its run -- so wait_refresh() below
        # can call poll_once() repeatedly and have its continuation-chain bookkeeping
        # (_drain_continuations' _last_continuation) stay correct across calls.
        app.state.job_worker = JobWorker(app.state.runner, app.state.sessionmaker)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/admin/unlock", json={"password": "hunter2"})
            yield app, client
    get_settings.cache_clear()


@pytest.fixture
async def locked_api(engine, monkeypatch):
    """(app, client) with ADMIN_PASSWORD set but NOT unlocked (fresh cookie jar)."""
    monkeypatch.setenv("USE_FAKE_ADAPTERS", "true")
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("ADMIN_PASSWORD", "hunter2")
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


@pytest.fixture
async def no_admin_api(engine, monkeypatch):
    """(app, client) with NO ADMIN_PASSWORD -> deny-all writes."""
    monkeypatch.setenv("USE_FAKE_ADAPTERS", "true")
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
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
    """Drain enqueued jobs the way the `worker` container does, then wait for any
    follow-up job RefreshRunner chains into on a clean finish.

    Api routes call RefreshRunner.enqueue() now (creates an unclaimed row; nothing runs
    it in-process) instead of running jobs themselves, so tests need to actually play
    the worker's role: poll to a fixed point using the app's JobWorker (app.state.
    job_worker, built once by the `api` fixture above) -- the same poll_once() the real
    worker container's run_forever() calls in a loop. poll_once() already drains
    same-call continuations via _drain_continuations() (see app/worker.py); the explicit
    call below catches continuations started by a direct runner.start() -- a few tests,
    and scheduler.py, still call that themselves -- which poll_once() never sees because
    there was nothing left to claim.
    """
    worker = app.state.job_worker
    while True:
        ran = await worker.poll_once()
        await worker._drain_continuations()
        if not ran:
            break
