"""Ticker validation over HTTP, for the worker process."""
import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)


class HttpTickerValidator:
    """Same interface as TickerValidator, but asks the api instead of yfinance.

    Results are memoized for the process lifetime, matching TickerValidator.
    """

    def __init__(
        self,
        base_url: str,
        *,
        client: httpx.AsyncClient | None = None,
        retries: int = 2,
        backoff_seconds: float = 1.0,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._retries = retries
        self._backoff = backoff_seconds
        self._cache: dict[str, bool] = {}

    async def is_valid(self, ticker: str) -> bool:
        normalized = ticker.strip().upper()
        if normalized in self._cache:
            return self._cache[normalized]
        exists = await self._ask(normalized)
        self._cache[normalized] = exists
        return exists

    async def _ask(self, ticker: str) -> bool:
        url = f"{self._base_url}/api/internal/tickers/{ticker}/exists"
        for attempt in range(self._retries + 1):
            try:
                resp = await self._client.get(url)
                resp.raise_for_status()
                return bool(resp.json()["data"]["exists"])
            except Exception as exc:
                if attempt < self._retries:
                    if self._backoff:
                        await asyncio.sleep(self._backoff * (attempt + 1))
                    continue
                # Fail OPEN. Dropping a ticker is a silent, permanent data loss; keeping a
                # bogus one is visible and fixable by re-analysing the video.
                logger.warning(
                    "ticker validation unavailable for %s (%s); keeping it", ticker, exc
                )
                return True
        return True

    async def aclose(self) -> None:
        await self._client.aclose()
