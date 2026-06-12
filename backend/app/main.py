from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import models  # noqa: F401  # 註冊 models 供 create_all
from app.config import get_settings
from app.db import Base, create_engine_and_sessionmaker


@asynccontextmanager
async def lifespan(application: FastAPI):
    settings = get_settings()
    settings.validate_required_keys()
    engine, sessionmaker = create_engine_and_sessionmaker(settings.database_url)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        from app.pipeline.jobs import fail_orphan_jobs

        await fail_orphan_jobs(sessionmaker)
        application.state.engine = engine
        application.state.sessionmaker = sessionmaker
        yield
    finally:
        await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="Stance Radar API", lifespan=lifespan)

    @app.get("/api/health")
    async def health() -> dict:
        return {"success": True, "data": {"status": "ok"}, "error": None}

    return app


app = create_app()
