from typing import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.market.client import MarketClient
from app.pipeline.refresh import RefreshRunner
from app.youtube.client import YouTubeClient


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


def get_market(request: Request) -> MarketClient:
    return request.app.state.market


def get_youtube(request: Request) -> YouTubeClient:
    return request.app.state.youtube


def get_runner(request: Request) -> RefreshRunner:
    return request.app.state.runner
