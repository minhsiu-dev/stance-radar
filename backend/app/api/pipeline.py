from datetime import timedelta

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import get_session, get_sessionmaker
from app.auth import require_admin
from app.config import get_settings
from app.envelope import fail, ok
from app.models import LANES, utcnow
from app.pipeline import lane_store
from app.pipeline.snapshot import build_snapshot

router = APIRouter(prefix="/api/pipeline")


@router.get("")
async def pipeline_snapshot(session: AsyncSession = Depends(get_session)):
    offline_after = timedelta(seconds=get_settings().lane_offline_seconds)
    return ok(await build_snapshot(session, now=utcnow(), offline_after=offline_after))


async def _set_paused(
    lane: str, paused: bool, sessionmaker: async_sessionmaker[AsyncSession]
) -> dict | JSONResponse:
    if lane not in LANES:
        return fail(f"Unknown lane: {lane}", status_code=404)
    await lane_store.ensure_lanes(sessionmaker)
    if paused:
        await lane_store.pause(sessionmaker, lane)
    else:
        await lane_store.resume(sessionmaker, lane)
    return ok({"lane": lane, "paused": paused})


@router.post("/lanes/{lane}/pause")
async def pause_lane(
    lane: str,
    sessionmaker: async_sessionmaker[AsyncSession] = Depends(get_sessionmaker),
    _: None = Depends(require_admin),
):
    return await _set_paused(lane, True, sessionmaker)


@router.post("/lanes/{lane}/resume")
async def resume_lane(
    lane: str,
    sessionmaker: async_sessionmaker[AsyncSession] = Depends(get_sessionmaker),
    _: None = Depends(require_admin),
):
    return await _set_paused(lane, False, sessionmaker)
