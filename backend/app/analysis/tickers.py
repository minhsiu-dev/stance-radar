from typing import Protocol

from app.market.client import MarketClient


class TickerValidatorLike(Protocol):
    async def is_valid(self, ticker: str) -> bool: ...


class TickerValidator:
    """Validate ticker existence via MarketClient; results are memoized for the process lifetime."""

    def __init__(self, market: MarketClient) -> None:
        self._market = market
        self._cache: dict[str, bool] = {}

    async def is_valid(self, ticker: str) -> bool:
        normalized = ticker.strip().upper()
        if normalized in self._cache:
            return self._cache[normalized]
        exists = await self._market.ticker_exists(normalized)
        self._cache[normalized] = exists
        return exists
