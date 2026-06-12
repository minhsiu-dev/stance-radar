from app.analysis.tickers import TickerValidator


class CountingMarket:
    def __init__(self, known: set[str]):
        self.known = known
        self.calls = 0

    async def ticker_exists(self, ticker: str) -> bool:
        self.calls += 1
        return ticker in self.known


async def test_valid_and_invalid_tickers():
    market = CountingMarket({"AAPL"})
    validator = TickerValidator(market)
    assert await validator.is_valid("AAPL") is True
    assert await validator.is_valid("ZZZZ") is False


async def test_caches_results_per_ticker():
    market = CountingMarket({"AAPL"})
    validator = TickerValidator(market)
    await validator.is_valid("AAPL")
    await validator.is_valid("aapl")   # 正規化後同一檔
    await validator.is_valid(" AAPL ")
    assert market.calls == 1
