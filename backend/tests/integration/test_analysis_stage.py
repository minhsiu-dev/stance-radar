import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from app.analysis.llm import AnalysisError, FakeLLMClient, UsageLimitReached
from app.analysis.tickers import TickerValidator
from app.analysis.types import (
    AnalysisResponse, AnalysisResult, MentionResult, StanceResult, UsageSnapshot, UsageWindow,
)
from app.pipeline import lane_store
from app.config import Settings
from app.market.client import FakeMarketClient
from app.models import (
    ANALYSIS_LANE, Channel, Mention, PipelineLane, Video, VideoStance, VideoStatus, utcnow,
)
from app.pipeline.analysis_stage import AnalysisStage
from app.pipeline.lane_factory import build_analysis_lane
from app.pipeline.stages import NEUTRAL, SUCCESS, failure
from app.transcripts.client import FakeTranscriptClient, transcript_to_json

BASE = datetime(2026, 6, 1, tzinfo=timezone.utc)


async def stored(video_id: str) -> dict:
    return transcript_to_json(await FakeTranscriptClient().fetch(video_id))


async def seed(sessionmaker, *ids, claimed=True, transcript=True, attempts=0) -> None:
    async with sessionmaker() as s:
        s.add(Channel(id="ch", title="c", thumbnail_url="", uploads_playlist_id="UU"))
        for day, vid_id in enumerate(ids):
            s.add(Video(
                id=vid_id, channel_id="ch", title=vid_id,
                published_at=BASE + timedelta(days=day), thumbnail_url="",
                status=VideoStatus.transcribed, analysis_attempts=attempts,
                transcript=await stored("alpha_vid_3") if transcript else None,
                claimed_at=utcnow() if claimed else None,
            ))
        await s.commit()


async def get(sessionmaker, vid_id) -> Video:
    async with sessionmaker() as s:
        return await s.get(Video, vid_id)


async def mention_count(sessionmaker, vid_id) -> int:
    async with sessionmaker() as s:
        return (await s.execute(
            select(func.count()).select_from(Mention).where(Mention.video_id == vid_id)
        )).scalar_one()


def make_stage(sessionmaker, llm=None, validator=None) -> AnalysisStage:
    return AnalysisStage(
        sessionmaker, llm or FakeLLMClient(), validator or TickerValidator(FakeMarketClient())
    )


def make_lane(sessionmaker, llm, *, concurrency=1):
    settings = Settings(analysis_concurrency=concurrency, worker_poll_seconds=0.01, _env_file=None)
    return build_analysis_lane(sessionmaker, llm, TickerValidator(FakeMarketClient()), settings)


async def test_success_persists_mentions_and_stances_and_marks_analyzed(sessionmaker):
    await seed(sessionmaker, "alpha_vid_3")

    assert await make_stage(sessionmaker).process("alpha_vid_3") == SUCCESS
    video = await get(sessionmaker, "alpha_vid_3")
    assert video.status is VideoStatus.analyzed
    assert (video.analysis_attempts, video.transcript_attempts) == (1, 0)
    assert video.claimed_at is None
    assert video.analyzed_at is not None
    assert video.transcript_language == "zh-TW"
    async with sessionmaker() as s:
        aapl = (await s.execute(
            select(Mention).where(Mention.video_id == "alpha_vid_3", Mention.ticker == "AAPL")
        )).scalars().one()
        stance = await s.get(VideoStance, ("alpha_vid_3", "AAPL"))
    # excerpt: one composed passage around the anchor, neighbours included
    assert aapl.excerpt == "今天來看蘋果的財報 蘋果這季財報很強,我會買 以上是今天的內容"
    assert stance is not None


async def test_reanalysis_replaces_rather_than_duplicates(sessionmaker):
    await seed(sessionmaker, "alpha_vid_3")
    stage = make_stage(sessionmaker)
    await stage.process("alpha_vid_3")
    await stage.process("alpha_vid_3")
    assert await mention_count(sessionmaker, "alpha_vid_3") == 1


async def test_unknown_tickers_are_dropped_and_recorded(sessionmaker):
    await seed(sessionmaker, "v")

    class UnknownTickerLLM:
        async def analyze(self, *, video_id, video_title, transcript):
            return AnalysisResponse(AnalysisResult(
                mentions=(MentionResult("ZZZZ", 1.0, "q", "buy", "r"),),
                stances=(StanceResult("ZZZZ", "buy", "s"),),
            ))

    assert await make_stage(sessionmaker, UnknownTickerLLM()).process("v") == SUCCESS
    video = await get(sessionmaker, "v")
    assert video.status is VideoStatus.analyzed
    assert video.dropped_tickers == ["ZZZZ"]
    assert await mention_count(sessionmaker, "v") == 0


async def test_a_conditional_overall_stance_is_persisted(sessionmaker):
    await seed(sessionmaker, "v")

    class ConditionalLLM:
        async def analyze(self, *, video_id, video_title, transcript):
            return AnalysisResponse(AnalysisResult(
                mentions=(MentionResult(
                    "NVDA", 1.0, "exit plan at 625", "sell", "will trim at 625+",
                    is_conditional=True, condition="at 625+",
                ),),
                stances=(StanceResult(
                    "NVDA", "sell", "exit plan", confidence="high", is_conditional=True,
                ),),
            ))

    await make_stage(sessionmaker, ConditionalLLM()).process("v")
    async with sessionmaker() as s:
        stance = await s.get(VideoStance, ("v", "NVDA"))
    assert stance.is_conditional is True


async def test_an_analysis_error_fails_the_video_and_keeps_its_transcript(sessionmaker):
    await seed(sessionmaker, "v")

    class FlakyLLM:
        async def analyze(self, *, video_id, video_title, transcript):
            raise AnalysisError("temporary failure")

    assert await make_stage(sessionmaker, FlakyLLM()).process("v") == failure("temporary failure")
    video = await get(sessionmaker, "v")
    assert (video.status, video.error_message) == (VideoStatus.failed, "temporary failure")
    assert video.transcript is not None
    assert video.analysis_attempts == 1
    assert video.claimed_at is None


async def test_an_unexpected_error_fails_the_video_too(sessionmaker):
    await seed(sessionmaker, "alpha_vid_3")

    class DownValidator:
        async def is_valid(self, ticker):
            raise RuntimeError("api unreachable")

    outcome = await make_stage(sessionmaker, validator=DownValidator()).process("alpha_vid_3")
    assert outcome == failure("api unreachable")
    video = await get(sessionmaker, "alpha_vid_3")
    assert (video.status, video.error_message) == (VideoStatus.failed, "api unreachable")
    assert video.transcript is not None  # the old rollback-misfiling bug stays fixed


async def test_a_missing_transcript_is_routed_back_to_the_transcript_lane(sessionmaker):
    await seed(sessionmaker, "v", transcript=False)

    assert await make_stage(sessionmaker).process("v") == NEUTRAL
    video = await get(sessionmaker, "v")
    assert (video.status, video.analysis_attempts, video.claimed_at) == (
        VideoStatus.pending, 0, None,
    )


async def test_video_deleted_mid_analysis_is_neutral(sessionmaker):
    await seed(sessionmaker, "alpha_vid_3")

    class DeletingLLM(FakeLLMClient):
        async def analyze(self, *, video_id, video_title, transcript):
            async with sessionmaker() as s:  # the channel was removed meanwhile
                await s.execute(delete(Video).where(Video.id == video_id))
                await s.commit()
            return await super().analyze(
                video_id=video_id, video_title=video_title, transcript=transcript
            )

    assert await make_stage(sessionmaker, DeletingLLM()).process("alpha_vid_3") == NEUTRAL
    assert await mention_count(sessionmaker, "alpha_vid_3") == 0


async def test_the_first_failure_pauses_the_analysis_lane(sessionmaker):
    await seed(sessionmaker, "v0", "v1", "v2", claimed=False)

    class QuotaLLM:
        async def analyze(self, *, video_id, video_title, transcript):
            raise AnalysisError("usage limit reached")

    assert await make_lane(sessionmaker, QuotaLLM()).drain() == 1
    async with sessionmaker() as s:
        row = await s.get(PipelineLane, ANALYSIS_LANE)
        left = (await s.execute(
            select(Video.id).where(
                Video.status == VideoStatus.transcribed, Video.claimed_at.is_(None)
            )
        )).scalars().all()
    assert (row.paused, row.pause_reason, row.last_error) == (True, "auto", "usage limit reached")
    assert sorted(left) == ["v0", "v1"]


async def test_video_deleted_mid_analysis_before_failing_llm_returns_neutral(sessionmaker):
    await seed(sessionmaker, "v")

    class DeleteThenFailLLM:
        async def analyze(self, *, video_id, video_title, transcript):
            async with sessionmaker() as s:  # delete the video row
                await s.execute(delete(Video).where(Video.id == video_id))
                await s.commit()
            raise AnalysisError("boom")

    assert await make_stage(sessionmaker, DeleteThenFailLLM()).process("v") == NEUTRAL
    assert await mention_count(sessionmaker, "v") == 0


async def test_video_deleted_mid_analysis_before_failing_llm_does_not_pause_lane(sessionmaker):
    await seed(sessionmaker, "v", claimed=False)

    class DeleteThenFailLLM:
        async def analyze(self, *, video_id, video_title, transcript):
            async with sessionmaker() as s:  # delete the video row
                await s.execute(delete(Video).where(Video.id == video_id))
                await s.commit()
            raise AnalysisError("boom")

    assert await make_lane(sessionmaker, DeleteThenFailLLM()).drain() == 1
    async with sessionmaker() as s:
        row = await s.get(PipelineLane, ANALYSIS_LANE)
    assert (row.paused, row.last_error) == (False, None)


async def test_pausing_does_not_cancel_slots_already_in_flight(sessionmaker):
    await seed(sessionmaker, "slow", "fast", claimed=False)  # both claimed at once

    class MixedLLM:
        async def analyze(self, *, video_id, video_title, transcript):
            if video_id == "fast":
                raise AnalysisError("usage limit reached")
            await asyncio.sleep(0.05)
            return AnalysisResponse(AnalysisResult.empty())

    assert await make_lane(sessionmaker, MixedLLM(), concurrency=2).drain() == 2
    assert (await get(sessionmaker, "slow")).status is VideoStatus.analyzed
    assert (await get(sessionmaker, "fast")).status is VideoStatus.failed


# ---- Claude usage throttle ----


def over_5h(reset) -> UsageSnapshot:
    return UsageSnapshot("allowed", UsageWindow(0.72, reset), UsageWindow(0.1, reset), reset)


async def analysis_row(sessionmaker) -> PipelineLane:
    async with sessionmaker() as s:
        return await s.get(PipelineLane, ANALYSIS_LANE)


async def test_a_usage_limit_gives_the_video_back_unfailed(sessionmaker):
    await seed(sessionmaker, "alpha_vid_3")
    reset = utcnow() + timedelta(hours=2)
    llm = FakeLLMClient(limit=UsageLimitReached("hit", reset))
    out = await make_stage(sessionmaker, llm).process("alpha_vid_3")
    assert (out.kind, out.resume_at) == ("limit", reset)
    video = await get(sessionmaker, "alpha_vid_3")
    assert (video.status, video.analysis_attempts, video.claimed_at) == (
        VideoStatus.transcribed, 0, None,
    )


async def test_a_limit_without_reset_time_falls_back_to_30_minutes(sessionmaker):
    await seed(sessionmaker, "alpha_vid_3")
    before = utcnow()
    llm = FakeLLMClient(limit=UsageLimitReached("hit", None))
    out = await make_stage(sessionmaker, llm).process("alpha_vid_3")
    assert before + timedelta(minutes=30) <= out.resume_at <= utcnow() + timedelta(minutes=30)


async def test_success_carries_the_usage(sessionmaker):
    await seed(sessionmaker, "alpha_vid_3")
    usage = UsageSnapshot("allowed", None, None, None)
    out = await make_stage(sessionmaker, FakeLLMClient(usage=usage)).process("alpha_vid_3")
    assert (out.kind, out.usage) == ("success", usage)


async def test_crossing_the_5h_threshold_pauses_the_lane_until_reset(sessionmaker):
    await seed(sessionmaker, "v0", "v1", claimed=False)
    reset = utcnow() + timedelta(hours=2)
    assert await make_lane(sessionmaker, FakeLLMClient(usage=over_5h(reset))).drain() == 1
    row = await analysis_row(sessionmaker)
    assert (row.paused, row.pause_reason, row.resume_at) == (True, "limit", reset)
    assert row.last_error == "5-hour usage 72% >= 70%"
    assert row.usage["five_hour"]["utilization"] == 0.72
    assert (await get(sessionmaker, "v0")).status is VideoStatus.transcribed  # not claimed


async def test_a_limit_pause_resumes_by_itself_once_due(sessionmaker):
    await seed(sessionmaker, "v0", claimed=False)
    await lane_store.ensure_lanes(sessionmaker)
    await lane_store.pause_for_limit(
        sessionmaker, ANALYSIS_LANE, utcnow() - timedelta(seconds=1), "x"
    )
    assert await make_lane(sessionmaker, FakeLLMClient()).drain() == 1
    assert (await get(sessionmaker, "v0")).status is VideoStatus.analyzed
    assert (await analysis_row(sessionmaker)).paused is False


async def test_a_limit_outcome_does_not_count_as_a_failure(sessionmaker):
    await seed(sessionmaker, "v0", claimed=False)
    llm = FakeLLMClient(limit=UsageLimitReached("hit", utcnow() + timedelta(hours=1)))
    await make_lane(sessionmaker, llm).drain()
    row = await analysis_row(sessionmaker)
    assert (row.pause_reason, row.consecutive_failures, row.last_error) == ("limit", 0, "hit")
    assert (await get(sessionmaker, "v0")).status is VideoStatus.transcribed
