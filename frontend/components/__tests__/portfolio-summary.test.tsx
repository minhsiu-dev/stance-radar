import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PrivacyProvider } from "@/components/privacy-provider";
import { PortfolioSummary } from "@/components/portfolio-summary";

const messages = {
  Portfolio: {
    totals: {
      totalValue: "Total value", marketValue: "Market value", cash: "Cash",
      costBasis: "Cost basis", unrealizedPl: "Unrealized P/L", todayPl: "Today's P/L",
    },
    cashDialog: { title: "Set cash", placeholder: "0.00", save: "Save", edit: "Edit" },
  },
};

function wrap(data: unknown) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher: vi.fn().mockResolvedValue(data), provider: () => new Map() }}>
        <PrivacyProvider>
          <PortfolioSummary />
        </PrivacyProvider>
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe("PortfolioSummary", () => {
  it("renders a Today's P/L card with $ and %", async () => {
    wrap({
      holdings: [
        { ticker: "AAPL", shares: 10, avg_cost: 100, price: 150, change_percent: 2,
          market_value: 1500, unrealized_pl: 500, unrealized_pl_percent: 50, weight: 100 },
      ],
      totals: {
        market_value: 1500, cost_basis: 1000, unrealized_pl: 500, unrealized_pl_percent: 50,
        cash: 0, total_value: 1500, cash_weight: 0,
      },
    });
    expect(await screen.findByText("Today's P/L")).toBeInTheDocument();
    // 10 sh @150 +2% -> today$ ≈ 29.41 (+2.0%)
    expect(screen.getByText(/\$29\.41/)).toBeInTheDocument();
    expect(screen.getByText(/\+2\.0%/)).toBeInTheDocument();
  });
});
