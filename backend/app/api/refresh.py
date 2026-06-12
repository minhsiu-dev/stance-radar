from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_runner, get_session
from app.config import get_settings
from app.envelope import ok
from app.models import Job, JobKind
from app.pipeline.jobs import get_running_job
from app.pipeline.refresh import RefreshRunner

router = APIRouter(prefix="/api")


def job_to_dict(job: Job) -> dict:
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status.value,
        "progress": job.progress,
        "started_at": job.started_at.isoformat(),
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "error_message": job.error_message,
    }


@router.post("/refresh")
async def trigger_refresh(runner: RefreshRunner = Depends(get_runner)):
    job_id, created = await runner.start(JobKind.discover)
    return ok({"job_id": job_id, "created": created})


@router.get("/settings")
async def app_settings():
    settings = get_settings()
    return ok({"auto_refresh_minutes": settings.auto_refresh_minutes})


@router.get("/jobs/current")
async def current_job(session: AsyncSession = Depends(get_session)):
    job = await get_running_job(session)
    if job is None:
        # 沒有進行中的 job → 回最近一個(讓前端顯示完成/錯誤狀態);完全沒有 → 204
        job = (await session.execute(
            select(Job).order_by(Job.id.desc()).limit(1)
        )).scalars().first()
    if job is None:
        return Response(status_code=204)
    return ok(job_to_dict(job))
