from app.market.client import MarketClient


class TickerValidator:
    """以 MarketClient 驗證 ticker 存在性,結果在程序生命週期內記憶。"""

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
