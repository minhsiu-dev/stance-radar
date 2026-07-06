from __future__ import annotations

import enum
from datetime import date as date_type
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer,
    String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class VideoStatus(str, enum.Enum):
    discovered = "discovered"
    pending = "pending"
    analyzed = "analyzed"
    no_transcript = "no_transcript"
    failed = "failed"
    skipped = "skipped"


class JobKind(str, enum.Enum):
    discover = "discover"
    analyze = "analyze"
    load_older = "load_older"


class Stance(str, enum.Enum):
    buy = "buy"
    neutral = "neutral"
    sell = "sell"


class JobStatus(str, enum.Enum):
    running = "running"
    done = "done"
    failed = "failed"


def _enum(e: type[enum.Enum], name: str) -> Enum:
    return Enum(e, name=name, values_callable=lambda x: [m.value for m in x])


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    thumbnail_url: Mapped[str] = mapped_column(Text, default="")
    uploads_playlist_id: Mapped[str] = mapped_column(String(34))
    # When enabled, "newly published" videos found by discover go straight to analysis, no manual selection needed
    auto_analyze: Mapped[bool] = mapped_column(Boolean, default=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_refreshed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    videos: Mapped[list[Video]] = relationship(
        back_populates="channel", cascade="all, delete-orphan", passive_deletes=True
    )


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    channel_id: Mapped[str] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(Text)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    thumbnail_url: Mapped[str] = mapped_column(Text, default="")
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[VideoStatus] = mapped_column(
        _enum(VideoStatus, "video_status"), default=VideoStatus.pending, index=True
    )
    transcript_language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Full fetched transcript (segments + language) so re-analysis runs offline; null until first stored
    transcript: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Tickers reported by the LLM but dropped because they failed ticker validation (lets the user know something was skipped)
    dropped_tickers: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    analyzed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    channel: Mapped[Channel] = relationship(back_populates="videos")
    mentions: Mapped[list[Mention]] = relationship(
        back_populates="video", cascade="all, delete-orphan", passive_deletes=True
    )
    stances: Mapped[list[VideoStance]] = relationship(
        back_populates="video", cascade="all, delete-orphan", passive_deletes=True
    )


class Mention(Base):
    __tablename__ = "mentions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(
        ForeignKey("videos.id", ondelete="CASCADE"), index=True
    )
    ticker: Mapped[str] = mapped_column(String(10), index=True)
    start_seconds: Mapped[float] = mapped_column(Float)
    quote: Mapped[str] = mapped_column(Text)
    stance: Mapped[Stance] = mapped_column(_enum(Stance, "stance"))
    reasoning: Mapped[str] = mapped_column(Text)
    # Old format: mechanically extracted surrounding context (newer videos use excerpt; these two columns are NULL)
    context_before: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_after: Mapped[str | None] = mapped_column(Text, nullable=True)
    # New format: raw transcript text around the mention (merged into a single passage; NULL for older data)
    excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Stance details (NULL for older data): high|medium|low / short|long|unspecified
    confidence: Mapped[str | None] = mapped_column(String(8), nullable=True)
    time_horizon: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_conditional: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    condition: Mapped[str | None] = mapped_column(Text, nullable=True)

    video: Mapped[Video] = relationship(back_populates="mentions")


class VideoStance(Base):
    __tablename__ = "video_stances"

    video_id: Mapped[str] = mapped_column(
        ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True
    )
    ticker: Mapped[str] = mapped_column(String(10), primary_key=True, index=True)
    stance: Mapped[Stance] = mapped_column(_enum(Stance, "stance"))
    summary: Mapped[str] = mapped_column(Text)
    confidence: Mapped[str | None] = mapped_column(String(8), nullable=True)

    video: Mapped[Video] = relationship(back_populates="stances")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    status: Mapped[JobStatus] = mapped_column(_enum(JobStatus, "job_status"))
    kind: Mapped[str] = mapped_column(String(16), default=JobKind.discover.value)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    progress: Mapped[dict] = mapped_column(JSONB, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class PriceBar(Base):
    """Daily-candle cache: historical daily candles are immutable; once stored we don't re-fetch from yfinance.

    OHLC intentionally uses Float (not Numeric): this is a re-fetchable market-data cache, not accounting data;
    all downstream calculations (performance backtests, scorecard) use float, and this matches the Candle dataclass.
    """

    __tablename__ = "price_bars"

    ticker: Mapped[str] = mapped_column(String(10), primary_key=True)
    date: Mapped[date_type] = mapped_column(Date, primary_key=True)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[int] = mapped_column(BigInteger)


class PriceCoverage(Base):
    """The contiguous date range each ticker already covers in price_bars."""

    __tablename__ = "price_coverage"

    ticker: Mapped[str] = mapped_column(String(10), primary_key=True)
    start_date: Mapped[date_type] = mapped_column(Date)
    end_date: Mapped[date_type] = mapped_column(Date)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # written by PriceStore on sync; no default at creation
