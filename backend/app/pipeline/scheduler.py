"""背景自動更新:每隔 N 分鐘 discover 一次,有 pending 影片就接著 analyze。

AUTO_REFRESH_MINUTES=0(預設)時不啟動,行為與手動模式完全相同。
與手動觸發共用 RefreshRunner 的單一 job 鎖:撞到進行中的 job 就略過本輪。
"""
import asyncio
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import JobKind, Video, VideoStatus
from app.pipeline.refresh import RefreshRunner

logger = logging.getLogger(__name__)


class AutoRefreshScheduler:
    def __init__(
        self,
        runner: RefreshRunner,
        sessionmaker: async_sessionmaker[AsyncSession],
        interval_minutes: int,
    ) -> None:
        self._runner = runner
        self._sessionmaker = sessionmaker
        self._interval_minutes = interval_minutes
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._interval_minutes <= 0 or self._task is not None:
            return
        self._task = asyncio.create_task(self._loop())
        logger.info("auto refresh enabled: every %s minutes", self._interval_minutes)

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval_minutes * 60)
            try:
                await self.run_once()
            except Exception:  # 單輪失敗不終止排程
                logger.exception("auto refresh cycle failed")

    async def run_once(self) -> None:
        """discover → (有 pending 時)analyze。回合間等 job 真正跑完。"""
        _, created = await self._runner.start(JobKind.discover)
        if not created:
            logger.info("auto refresh skipped: another job is running")
            return
        await self._wait_current()
        if await self._has_pending_videos():
            _, created = await self._runner.start(JobKind.analyze)
            if created:
                await self._wait_current()

    async def _wait_current(self) -> None:
        task = self._runner.current_task
        if task is not None:
            await asyncio.shield(task)

    async def _has_pending_videos(self) -> bool:
        async with self._sessionmaker() as session:
            count = (await session.execute(
                select(func.count()).select_from(Video)
                .where(Video.status == VideoStatus.pending)
            )).scalar_one()
        return count > 0
