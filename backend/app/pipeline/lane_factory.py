"""Builds the two lanes from settings. Shared by app/worker.py and the test harness
(tests/conftest.py) so both run exactly the same wiring."""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.analysis.llm import AnalysisInfrastructureError, LLMClient
from app.analysis.tickers import TickerValidatorLike
from app.config import Settings
from app.models import ANALYSIS_LANE, TRANSCRIPT_LANE, VideoStatus
from app.pipeline.analysis_stage import AnalysisStage
from app.pipeline.lanes import Lane
from app.pipeline.transcript_stage import TranscriptStage
from app.transcripts.client import TranscriptClient


def build_transcript_lane(
    sessionmaker: async_sessionmaker[AsyncSession],
    transcripts: TranscriptClient,
    settings: Settings,
) -> Lane:
    return Lane(
        name=TRANSCRIPT_LANE,
        input_status=VideoStatus.pending,
        stage=TranscriptStage(sessionmaker, transcripts),
        sessionmaker=sessionmaker,
        concurrency=settings.transcript_concurrency,
        pause_after=settings.transcript_pause_after_failures,
        poll_seconds=settings.worker_poll_seconds,
    )


def build_analysis_lane(
    sessionmaker: async_sessionmaker[AsyncSession],
    llm: LLMClient,
    ticker_validator: TickerValidatorLike,
    settings: Settings,
) -> Lane:
    return Lane(
        name=ANALYSIS_LANE,
        input_status=VideoStatus.transcribed,
        stage=AnalysisStage(sessionmaker, llm, ticker_validator),
        sessionmaker=sessionmaker,
        concurrency=settings.analysis_concurrency,
        pause_after=settings.analysis_pause_after_failures,
        poll_seconds=settings.worker_poll_seconds,
        fatal=(AnalysisInfrastructureError,),
    )
