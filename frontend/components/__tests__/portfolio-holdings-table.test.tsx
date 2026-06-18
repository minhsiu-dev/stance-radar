import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PortfolioHoldingsTable } from "@/components/portfolio-holdings-table";

const messages = {
  Portfolio: {
    holdings: {
      title: "Holdings", ticker: "Ticker", shares: "Shares", avgCost: "Avg cost",
      price: "Price", marketValue: "Value", pl: "P/L", weight: "Weight",
      cash: "Cash (USD)", empty: "No holdings yet",
    },
  },
};

// usePrivacy mock with new shape (component no longer calls it, but kept for safety)
vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => ({ hideHoldings: false, ready: true, toggle: vi.fn() }),
}));

function wrap(fetcher: () => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <PortfolioHoldingsTable />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe("PortfolioHoldingsTable", () => {
  it("renders a row per holding with P/L and weight", async () => {
    wrap(vi.fn().mockResolvedValue({
      holdings: [{
        ticker: "AAPL", shares: 10, avg_cost: 100, price: 150,
        change_percent: 1.2, market_value: 1500, unrealized_pl: 500,
        unrealized_pl_percent: 50, weight: 100,
      }],
      totals: {
        market_value: 1500, cost_basis: 1000, unrealized_pl: 500, unrealized_pl_percent: 50,
        cash: 0, total_value: 1500, cash_weight: 0,
      },
    }));
    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("+50.0%")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument();
  });

  it("shows empty state", async () => {
    wrap(vi.fn().mockResolvedValue({
      holdings: [],
      totals: {
        market_value: 0, cost_basis: 0, unrealized_pl: 0, unrealized_pl_percent: null,
        cash: 0, total_value: 0, cash_weight: null,
      },
    }));
    expect(await screen.findByText("No holdings yet")).toBeInTheDocument();
  });

  it("renders a cash row with value and weight when cash != 0", async () => {
    wrap(vi.fn().mockResolvedValue({
      holdings: [{
        ticker: "AAPL", shares: 10, avg_cost: 100, price: 150,
        change_percent: 1.2, market_value: 1500, unrealized_pl: 500,
        unrealized_pl_percent: 50, weight: 60,
      }],
      totals: {
        market_value: 1500, cost_basis: 1000, unrealized_pl: 500, unrealized_pl_percent: 50,
        cash: 1000, total_value: 2500, cash_weight: 40,
      },
    }));
    expect(await screen.findByText("Cash (USD)")).toBeInTheDocument();
    expect(screen.getByText("1,000.00")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
  });

  it("hides the cash row when cash == 0", async () => {
    wrap(vi.fn().mockResolvedValue({
      holdings: [{
        ticker: "AAPL", shares: 10, avg_cost: 100, price: 150,
        change_percent: 1.2, market_value: 1500, unrealized_pl: 500,
        unrealized_pl_percent: 50, weight: 100,
      }],
      totals: {
        market_value: 1500, cost_basis: 1000, unrealized_pl: 500, unrealized_pl_percent: 50,
        cash: 0, total_value: 1500, cash_weight: 0,
      },
    }));
    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByText("Cash (USD)")).toBeNull();
  });

  it("always shows real shares, cost, and value amounts (no masking)", async () => {
    wrap(vi.fn().mockResolvedValue({
      holdings: [{
        ticker: "AAPL", shares: 10, avg_cost: 100, price: 150,
        change_percent: 1.2, market_value: 1500, unrealized_pl: 500,
        unrealized_pl_percent: 50, weight: 100,
      }],
      totals: {
        market_value: 1500, cost_basis: 1000, unrealized_pl: 500, unrealized_pl_percent: 50,
        cash: 0, total_value: 1500, cash_weight: 0,
      },
    }));
    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();       // shares
    expect(screen.getByText("100.00")).toBeInTheDocument();   // avg_cost
    expect(screen.getByText("1,500.00")).toBeInTheDocument(); // market_value
    expect(screen.getByText("150.00")).toBeInTheDocument();   // price
    expect(screen.getByText("100.0%")).toBeInTheDocument();   // weight
    // Bullets must not appear (amounts are always shown)
    expect(screen.queryByText("••••")).toBeNull();
  });
});
