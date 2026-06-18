from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import models  # noqa: F401  # register models for create_all
from app.analysis.llm import ClaudeCLIClient, FakeLLMClient
from app.analysis.tickers import TickerValidator
from app.config import Settings, get_settings
from app.db import Base, create_engine_and_sessionmaker
from app.db_migrations import run_startup_migrations
from app.market.client import FakeMarketClient, YFinanceMarketClient
from app.market.store import PriceStore
from app.net.proxy import ProxyRotator
from app.pipeline.jobs import fail_orphan_jobs
from app.pipeline.refresh import RefreshDeps, RefreshRunner
from app.pipeline.scheduler import AutoRefreshScheduler
from app.transcripts.client import FakeTranscriptClient, YouTubeTranscriptApiClient
from app.youtube.client import DataAPIYouTubeClient, FakeYouTubeClient


def build_adapters(settings: Settings) -> dict:
    if settings.use_fake_adapters:
        return {
            "youtube": FakeYouTubeClient(),
            "transcripts": FakeTranscriptClient(),
            "llm": FakeLLMClient(),
            "market": FakeMarketClient(),
        }
    rotator = ProxyRotator(settings.gluetun_control_url)
    return {
        "youtube": DataAPIYouTubeClient(api_key=settings.youtube_api_key),
        "transcripts": YouTubeTranscriptApiClient(
            proxy_url=settings.fetch_proxy_url, rotator=rotator
        ),
        "llm": ClaudeCLIClient(
            binary=settings.claude_bin,
            model=settings.claude_model,
            timeout_seconds=settings.claude_timeout_seconds,
        ),
        "market": YFinanceMarketClient(
            proxy_url=settings.fetch_proxy_url, rotator=rotator
        ),
    }


@asynccontextmanager
async def lifespan(application: FastAPI):
    settings = get_settings()
    settings.validate_required_keys()
    engine, sessionmaker = create_engine_and_sessionmaker(settings.database_url)
    scheduler: AutoRefreshScheduler | None = None
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await run_startup_migrations(engine)
        await fail_orphan_jobs(sessionmaker)
        adapters = build_adapters(settings)
        application.state.engine = engine
        application.state.sessionmaker = sessionmaker
        application.state.market = adapters["market"]
        application.state.price_store = PriceStore(sessionmaker, adapters["market"])
        application.state.youtube = adapters["youtube"]
        application.state.runner = RefreshRunner(RefreshDeps(
            sessionmaker=sessionmaker,
            youtube=adapters["youtube"],
            transcripts=adapters["transcripts"],
            llm=adapters["llm"],
            ticker_validator=TickerValidator(adapters["market"]),
            settings=settings,
        ))
        scheduler = AutoRefreshScheduler(
            runner=application.state.runner,
            sessionmaker=sessionmaker,
            interval_minutes=settings.auto_refresh_minutes,
        )
        scheduler.start()
        application.state.scheduler = scheduler
        yield
    finally:
        if scheduler is not None:
            await scheduler.stop()
        await engine.dispose()


def create_app() -> FastAPI:
    from app.api import channels, feed, insights, portfolio, refresh, stocks, videos

    app = FastAPI(title="Stance Radar API", lifespan=lifespan)
    app.include_router(channels.router)
    app.include_router(refresh.router)
    app.include_router(feed.router)
    app.include_router(stocks.router)
    app.include_router(videos.router)
    app.include_router(insights.router)
    app.include_router(portfolio.router)

    @app.get("/api/health")
    async def health() -> dict:
        return {"success": True, "data": {"status": "ok"}, "error": None}

    return app


app = create_app()
