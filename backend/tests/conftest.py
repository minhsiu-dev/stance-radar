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


@pytest.fixture(autouse=True)
def _reset_channel_win_rate_cache():
    """get_channel_win_rates (app/insights/channel_win_rates.py) caches its result in a
    module-level global with a 300s TTL. A follow-up task makes weighted=true the
    trending endpoint's default, so most tests in this suite will end up exercising
    it while `engine` rebuilds the database per test -- without this, a cache
    populated by one test would leak stale win rates into the next test's
    assertions. Autouse + suite-wide (not just this module's own tests) so nothing
    has to opt in, now or once that wiring lands."""
    from app.insights.channel_win_rates import reset_cache

    reset_cache()
    yield


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

    from app.analysis.llm import FakeLLMClient
    from app.analysis.tickers import TickerValidator
    from app.main import create_app
    from app.pipeline.lane_factory import build_analysis_lane, build_transcript_lane
    from app.transcripts.client import FakeTranscriptClient
    from app.worker import JobWorker

    app = create_app()
    async with LifespanManager(app):
        # Production runs jobs and lanes in the worker containers (app/worker.py); api
        # routes only enqueue jobs and re-status videos. These play those containers
        # for wait_refresh() below, with the same fakes USE_FAKE_ADAPTERS wires up there.
        settings = get_settings()
        sessionmaker = app.state.sessionmaker
        app.state.job_worker = JobWorker(app.state.runner, sessionmaker)
        app.state.transcript_lane = build_transcript_lane(
            sessionmaker, FakeTranscriptClient(), settings
        )
        app.state.analysis_lane = build_analysis_lane(
            sessionmaker, FakeLLMClient(), TickerValidator(app.state.market), settings
        )
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
    """Play both worker containers to a fixed point.

    Drain enqueued jobs (discover / load_older) the way `worker` does, then both
    lanes -- transcript first, since its output is the analysis lane's input -- and
    repeat until a full pass does nothing: a discover can queue auto_analyze videos,
    and one lane's output feeds the next.

    A lane that paused itself (e.g. after an analysis failure) stops claiming, so this
    still terminates; a test that needs it running again calls the resume endpoint.
    """
    lanes = (app.state.transcript_lane, app.state.analysis_lane)
    while True:
        ran = False
        while await app.state.job_worker.poll_once():
            ran = True
        for lane in lanes:
            if await lane.drain():
                ran = True
        if not ran:
            return
