import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PortfolioHoldingsTable } from "@/components/portfolio-holdings-table";

const messages = {
  Portfolio: {
    holdings: {
      title: "Holdings", ticker: "Ticker", shares: "Shares", avgCost: "Avg cost",
      price: "Price", marketValue: "Value", pl: "P/L", weight: "Weight",
      empty: "No holdings yet",
    },
  },
};

function wrap(fetcher: () => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <PortfolioHoldingsTable />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("PortfolioHoldingsTable", () => {
  it("renders a row per holding with P/L and weight", async () => {
    wrap(vi.fn().mockResolvedValue({
      holdings: [{
        ticker: "AAPL", shares: 10, avg_cost: 100, price: 150,
        change_percent: 1.2, market_value: 1500, unrealized_pl: 500,
        unrealized_pl_percent: 50, weight: 100,
      }],
      totals: { market_value: 1500, cost_basis: 1000, unrealized_pl: 500, unrealized_pl_percent: 50 },
    }));
    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("+50.0%")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument();
  });

  it("shows empty state", async () => {
    wrap(vi.fn().mockResolvedValue({
      holdings: [],
      totals: { market_value: 0, cost_basis: 0, unrealized_pl: 0, unrealized_pl_percent: null },
    }));
    expect(await screen.findByText("No holdings yet")).toBeInTheDocument();
  });
});
