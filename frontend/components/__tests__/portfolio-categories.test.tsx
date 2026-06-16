import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PrivacyProvider } from "@/components/privacy-provider";
import { PortfolioCategories } from "@/components/portfolio-categories";

vi.mock("recharts", () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
}));
vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
  ChartLegend: () => null,
  ChartLegendContent: () => null,
}));

const messages = {
  Portfolio: {
    categories: {
      uncategorized: "Uncategorized", cash: "Cash", newPlaceholder: "New category name",
      add: "Add category", delete: "Delete", empty: "No holdings yet",
      dragHint: "Drag a ticker into a category",
    },
  },
};

function wrap(data: unknown) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher: vi.fn().mockResolvedValue(data), provider: () => new Map() }}>
        <PrivacyProvider>
          <PortfolioCategories />
        </PrivacyProvider>
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

const holdingsData = {
  holdings: [
    { ticker: "AAPL", shares: 10, avg_cost: 100, price: 150, change_percent: 1,
      market_value: 1500, unrealized_pl: 500, unrealized_pl_percent: 50, weight: 60 },
    { ticker: "MSFT", shares: 5, avg_cost: 100, price: 100, change_percent: 0,
      market_value: 500, unrealized_pl: 0, unrealized_pl_percent: 0, weight: 20 },
  ],
  totals: {
    market_value: 2000, cost_basis: 1500, unrealized_pl: 500, unrealized_pl_percent: 33,
    cash: 500, total_value: 2500, cash_weight: 20,
  },
};

beforeEach(() => localStorage.clear());

describe("PortfolioCategories", () => {
  it("puts every unassigned ticker in the Uncategorized lane", async () => {
    wrap(holdingsData);
    const lane = (await screen.findByTestId("lane-uncategorized"));
    expect(within(lane).getByText("AAPL")).toBeInTheDocument();
    expect(within(lane).getByText("MSFT")).toBeInTheDocument();
  });

  it("places a ticker in its assigned category lane", async () => {
    localStorage.setItem("stance-radar-categories", JSON.stringify({
      categories: [{ id: "c1", name: "Long-term" }], assignments: { AAPL: "c1" },
    }));
    wrap(holdingsData);
    const lane = await screen.findByTestId("lane-c1");
    expect(within(lane).getByText("AAPL")).toBeInTheDocument();
    const unc = screen.getByTestId("lane-uncategorized");
    expect(within(unc).queryByText("AAPL")).toBeNull();
    expect(within(unc).getByText("MSFT")).toBeInTheDocument();
  });

  it("shows the empty state when there are no holdings", async () => {
    wrap({ holdings: [], totals: { ...holdingsData.totals, cash: 0 } });
    expect(await screen.findByText("No holdings yet")).toBeInTheDocument();
  });
});
