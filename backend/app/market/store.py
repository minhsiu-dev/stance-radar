"""日 K 持久層:DB 為準,只對缺口打 yfinance(增量、批次)。

涵蓋規則(price_coverage 一檔一列,描述連續涵蓋區間):
- 無紀錄或要求起點早於 start_date → 整段重抓(避免拼接邏輯)
- end_date < today 且距上次同步 ≥1 小時 → 尾段補抓,往回多帶 7 天 overlap
- overlap 內收盤價偏差 >0.5% → 序列被重新調整(分割/除權息)→ 整檔清掉重抓
"""
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Mapping, Protocol

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.market.client import Candle, MarketClient
from app.models import PriceBar, PriceCoverage

logger = logging.getLogger(__name__)

_TRAILING_SYNC_INTERVAL = timedelta(hours=1)
_OVERLAP_DAYS = 7
_ADJUST_TOLERANCE = 0.005


class _CoverageLike(Protocol):
    start_date: date
    end_date: date
    last_synced_at: datetime


@dataclass(frozen=True)
class FetchPlan:
    full: dict[str, date] = field(default_factory=dict)
    trailing: dict[str, date] = field(default_factory=dict)


def plan_fetches(
    coverage: Mapping[str, _CoverageLike],
    tickers: Iterable[str],
    start: date,
    today: date,
    now: datetime,
) -> FetchPlan:
    full: dict[str, date] = {}
    trailing: dict[str, date] = {}
    for ticker in tickers:
        cov = coverage.get(ticker)
        if cov is None or cov.start_date > start:
            full[ticker] = start
        elif (
            cov.end_date < today
            and now - cov.last_synced_at >= _TRAILING_SYNC_INTERVAL
        ):
            trailing[ticker] = cov.end_date - timedelta(days=_OVERLAP_DAYS)
    return FetchPlan(full=full, trailing=trailing)
