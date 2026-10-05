"""A long-running loop over one stage of the pipeline.

The video `status` is the queue: the lane claims the newest unclaimed video in its
input status (lane_store.claim_next), runs up to `concurrency` of them at once,
stops claiming while the lane is paused, and pauses itself after `pause_after`
failures in a row. Exceptions listed in `fatal` mean the process itself is broken
(a `claude` child killed by a signal): every slot is cancelled and the exception
propagates so the worker exits and Docker restarts it with a clean address space.
"""
import asyncio
import logging
import time

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import VideoStatus
from app.pipeline import lane_store
from app.pipeline.stages import Stage, StageOutcome, failure

logger = logging.getLogger(__name__)


class Lane:
    def __init__(
        self,
        *,
        name: str,
        input_status: VideoStatus,
        stage: Stage,
        sessionmaker: async_sessionmaker[AsyncSession],
        concurrency: int,
        pause_after: int,
        poll_seconds: float = 1.0,
        heartbeat_seconds: float = 5.0,
        fatal: tuple[type[BaseException], ...] = (),
    ) -> None:
        self.name = name
        self.stage = stage
        self._input_status = input_status
        self._sessionmaker = sessionmaker
        self._concurrency = max(concurrency, 1)
        self._pause_after = max(pause_after, 1)
        self._poll_seconds = poll_seconds
        self._heartbeat_seconds = heartbeat_seconds
        self._fatal = fatal
        self._last_heartbeat = float("-inf")

    async def startup(self) -> int:
        """Release the claims a previous process of this lane left behind; returns
        how many. Only this lane's input status -- the other lane runs in another
        container and may be mid-flight."""
        await lane_store.ensure_lanes(self._sessionmaker)
        released = await lane_store.release_claims(self._sessionmaker, self._input_status)
        if released:
            logger.warning(
                "%s lane: released %s claim(s) left by a previous run", self.name, released
            )
        await lane_store.mark_started(self._sessionmaker, self.name, self._concurrency)
        self._last_heartbeat = time.monotonic()
        return released

    async def run_forever(self) -> None:
        await self.startup()
        await self._run(stop_when_idle=False)

    async def drain(self) -> int:
        """Process until nothing is claimable or the lane is paused; returns how many
        videos were processed. The test harness plays the worker with this; a fatal
        error still propagates exactly as it does from run_forever."""
        await lane_store.ensure_lanes(self._sessionmaker)
        return await self._run(stop_when_idle=True)

    async def _run(self, *, stop_when_idle: bool) -> int:
        processed = 0
        in_flight: set[asyncio.Task[None]] = set()
        try:
            while True:
                if not stop_when_idle:
                    await self._maybe_heartbeat()
                await self._fill(in_flight)
                if not in_flight:
                    if stop_when_idle:
                        return processed
                    await asyncio.sleep(self._poll_seconds)
                    continue
                done, _ = await asyncio.wait(
                    in_flight,
                    timeout=None if stop_when_idle else self._poll_seconds,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in done:
                    in_flight.discard(task)
                    task.result()  # re-raises a fatal error from the stage
                    processed += 1
        except self._fatal as exc:
            # The process is broken, not the video: stop every slot (each stage gives
            # its attempt back on cancellation), leave a note for /pipeline, and let
            # the worker exit for a restart.
            await self._cancel(in_flight)
            error = str(exc) or type(exc).__name__
            await lane_store.record_error(self._sessionmaker, self.name, error)
            raise
        finally:
            await self._cancel(in_flight)

    async def _fill(self, in_flight: set[asyncio.Task[None]]) -> None:
        while len(in_flight) < self._concurrency:
            if await lane_store.is_paused(self._sessionmaker, self.name):
                return
            video_id = await lane_store.claim_next(self._sessionmaker, self._input_status)
            if video_id is None:
                return
            in_flight.add(asyncio.create_task(self._handle(video_id)))

    async def _handle(self, video_id: str) -> None:
        try:
            outcome = await self.stage.process(video_id)
        except self._fatal:
            raise
        except Exception as exc:  # a stage bug must not leave the video claimed forever
            logger.exception("%s lane: stage crashed on %s", self.name, video_id)
            error = str(exc) or type(exc).__name__
            await lane_store.fail_video(
                self._sessionmaker, video_id, error, status=self._input_status
            )
            outcome = failure(error)
        await self._record(outcome)

    async def _record(self, outcome: StageOutcome) -> None:
        if outcome.kind == "success":
            await lane_store.record_success(self._sessionmaker, self.name)
        elif outcome.kind == "failure":
            paused = await lane_store.record_failure(
                self._sessionmaker, self.name, outcome.error or "",
                pause_after=self._pause_after,
            )
            if paused:
                logger.warning("%s lane paused: %s", self.name, outcome.error)

    async def _maybe_heartbeat(self) -> None:
        now = time.monotonic()
        if now - self._last_heartbeat >= self._heartbeat_seconds:
            await lane_store.heartbeat(self._sessionmaker, self.name)
            self._last_heartbeat = now

    @staticmethod
    async def _cancel(tasks: set[asyncio.Task[None]]) -> None:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        tasks.clear()
