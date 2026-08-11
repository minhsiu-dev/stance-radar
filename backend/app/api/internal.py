"""Endpoints the worker calls. Not part of the public UI surface.

The worker deliberately never imports yfinance (loading pandas/numpy/OpenBLAS in the
process that spawns `claude` is what this whole split exists to avoid), so ticker
validation is delegated back to the api, which already owns the market client.
"""
from fastapi import APIRouter, Request

from app.analysis.tickers import TickerValidator
from app.envelope import ok

router = APIRouter(prefix="/api/internal")


@router.get("/tickers/{ticker}/exists")
async def ticker_exists(ticker: str, request: Request):
    validator: TickerValidator = request.app.state.ticker_validator
    return ok({"exists": await validator.is_valid(ticker)})
