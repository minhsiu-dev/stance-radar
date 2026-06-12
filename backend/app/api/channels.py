import re

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_runner, get_session, get_youtube
from app.envelope import fail, ok
from app.models import Channel, utcnow
from app.pipeline.refresh import RefreshRunner
from app.youtube.client import ChannelNotFound, QuotaExceededError, YouTubeClient

router = APIRouter(prefix="/api/channels")


class AddChannelsRequest(BaseModel):
    channel_ids: str  # 換行/逗號/空白分隔,一個或多個


def parse_channel_ids(raw: str) -> list[str]:
    tokens = [t.strip() for t in re.split(r"[,\s]+", raw) if t.strip()]
    seen: set[str] = set()
    unique: list[str] = []
    for token in tokens:
        if token not in seen:
            seen.add(token)
            unique.append(token)
    return unique


def channel_to_dict(channel: Channel) -> dict:
    return {
        "id": channel.id,
        "title": channel.title,
        "thumbnail_url": channel.thumbnail_url,
        "added_at": channel.added_at.isoformat(),
        "last_refreshed_at": (
            channel.last_refreshed_at.isoformat() if channel.last_refreshed_at else None
        ),
    }


@router.post("")
async def add_channels(
    body: AddChannelsRequest,
    session: AsyncSession = Depends(get_session),
    youtube: YouTubeClient = Depends(get_youtube),
    runner: RefreshRunner = Depends(get_runner),
):
    channel_ids = parse_channel_ids(body.channel_ids)
    if not channel_ids:
        return fail("沒有可解析的 channel ID", status_code=400)

    existing = set((await session.execute(
        select(Channel.id).where(Channel.id.in_(channel_ids))
    )).scalars().all())

    added: list[dict] = []
    skipped: list[str] = []
    failed: list[dict] = []
    for channel_id in channel_ids:
        if channel_id in existing:
            skipped.append(channel_id)
            continue
        try:
            info = await youtube.resolve_channel(channel_id)
        except ChannelNotFound:
            failed.append({"id": channel_id, "reason": "查無此頻道"})
            continue
        except QuotaExceededError as exc:
            return fail(str(exc), status_code=503)
        channel = Channel(
            id=info.id, title=info.title, thumbnail_url=info.thumbnail_url,
            uploads_playlist_id=info.uploads_playlist_id,
            added_at=utcnow(),
        )
        session.add(channel)
        added.append(channel_to_dict(channel))
    await session.commit()

    job_id = None
    if added:
        job_id, _ = await runner.start()

    data = {"added": added, "skipped": skipped, "failed": failed, "job_id": job_id}
    if failed:
        # 部分失敗:400,但有效的照常加入(data 內含結果)
        return JSONResponse(
            status_code=400,
            content={"success": False, "data": data, "error": "部分 channel ID 無效"},
        )
    return ok(data)


@router.get("")
async def list_channels(session: AsyncSession = Depends(get_session)):
    channels = (await session.execute(
        select(Channel).order_by(Channel.added_at)
    )).scalars().all()
    return ok([channel_to_dict(c) for c in channels])


@router.delete("/{channel_id}")
async def delete_channel(
    channel_id: str, session: AsyncSession = Depends(get_session)
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        return fail(f"頻道 {channel_id} 不存在", status_code=404)
    await session.delete(channel)
    await session.commit()
    return ok({"deleted": channel_id})
