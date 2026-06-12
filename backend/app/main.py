from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import models  # noqa: F401  # 註冊 models 供 create_all
from app.analysis.llm import ClaudeCLIClient, FakeLLMClient
from app.analysis.tickers import TickerValidator
from app.config import Settings, get_settings
from app.db import Base, create_engine_and_sessionmaker
from app.market.client import FakeMarketClient, YFinanceMarketClient
from app.pipeline.jobs import fail_orphan_jobs
from app.pipeline.refresh import RefreshDeps, RefreshRunner
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
    return {
        "youtube": DataAPIYouTubeClient(api_key=settings.youtube_api_key),
        "transcripts": YouTubeTranscriptApiClient(),
        "llm": ClaudeCLIClient(binary=settings.claude_bin, model=settings.claude_model),
        "market": YFinanceMarketClient(),
    }


@asynccontextmanager
async def lifespan(application: FastAPI):
    settings = get_settings()
    settings.validate_required_keys()
    engine, sessionmaker = create_engine_and_sessionmaker(settings.database_url)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await fail_orphan_jobs(sessionmaker)
        adapters = build_adapters(settings)
        application.state.engine = engine
        application.state.sessionmaker = sessionmaker
        application.state.market = adapters["market"]
        application.state.youtube = adapters["youtube"]
        application.state.runner = RefreshRunner(RefreshDeps(
            sessionmaker=sessionmaker,
            youtube=adapters["youtube"],
            transcripts=adapters["transcripts"],
            llm=adapters["llm"],
            ticker_validator=TickerValidator(adapters["market"]),
            settings=settings,
        ))
        yield
    finally:
        await engine.dispose()


def create_app() -> FastAPI:
    from app.api import channels, feed, refresh

    app = FastAPI(title="Stance Radar API", lifespan=lifespan)
    app.include_router(channels.router)
    app.include_router(refresh.router)
    app.include_router(feed.router)

    @app.get("/api/health")
    async def health() -> dict:
        return {"success": True, "data": {"status": "ok"}, "error": None}

    return app


app = create_app()
