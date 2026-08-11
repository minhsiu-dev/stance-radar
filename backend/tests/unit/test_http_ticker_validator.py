"""The worker never imports yfinance; it asks the api. When the api is unreachable we
fail OPEN (keep the ticker): a stray bad ticker is visible and fixable, silently dropping
a real one is not."""
import httpx

from app.analysis.http_tickers import HttpTickerValidator


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_returns_the_apis_answer():
    async def handler(request):
        assert request.url.path == "/api/internal/tickers/NVDA/exists"
        return httpx.Response(200, json={
            "success": True, "data": {"exists": True}, "error": None,
        })

    v = HttpTickerValidator("http://api:8000", client=_client(handler))
    assert await v.is_valid("nvda") is True


async def test_memoizes_so_a_repeated_ticker_costs_one_request():
    calls = []

    async def handler(request):
        calls.append(request.url.path)
        return httpx.Response(200, json={
            "success": True, "data": {"exists": False}, "error": None,
        })

    v = HttpTickerValidator("http://api:8000", client=_client(handler))
    assert await v.is_valid("FAKE") is False
    assert await v.is_valid("FAKE") is False
    assert len(calls) == 1


async def test_fails_open_after_retries_when_the_api_is_down():
    calls = []

    async def handler(request):
        calls.append(request.url.path)
        raise httpx.ConnectError("api down")

    v = HttpTickerValidator(
        "http://api:8000", client=_client(handler), retries=2, backoff_seconds=0,
    )
    assert await v.is_valid("NVDA") is True   # fail open: keep the ticker
    assert len(calls) == 3                     # initial attempt + 2 retries
