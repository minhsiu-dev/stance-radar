from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_settings().validate_required_keys()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Stance Radar API", lifespan=lifespan)

    @app.get("/api/health")
    async def health() -> dict:
        return {"success": True, "data": {"status": "ok"}, "error": None}

    return app


app = create_app()
