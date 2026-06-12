import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

const swrResponses: Record<string, unknown> = {};
vi.mock("swr", () => ({
  default: (key: string) => ({ data: swrResponses[key] }),
}));

import { OverviewTab } from "@/components/overview-tab";

describe("OverviewTab", () => {
  it("renders YoY positive in emerald", () => {
    swrResponses["/api/stocks/AAPL/financials?period=quarterly"] = [
      { period_end: "2025-03", total_revenue: 100, net_income: 20, gross_profit: 40, operating_income: 25, pretax_income: 22 },
      { period_end: "2025-06", total_revenue: 100, net_income: 20, gross_profit: 40, operating_income: 25, pretax_income: 22 },
      { period_end: "2025-09", total_revenue: 100, net_income: 20, gross_profit: 40, operating_income: 25, pretax_income: 22 },
      { period_end: "2025-12", total_revenue: 100, net_income: 20, gross_profit: 40, operating_income: 25, pretax_income: 22 },
      { period_end: "2026-03", total_revenue: 110, net_income: 22, gross_profit: 44, operating_income: 27, pretax_income: 24 },
    ];
    swrResponses["/api/stocks/AAPL/stance-summary"] = {
      buy: 3, neutral: 1, sell: 0, window_days: 90,
    };
    swrResponses["/api/stocks/AAPL"] = {
      ticker: "AAPL", name: "Apple", price: 200, change: 1,
      change_percent: 0.5, market_cap: 3e12, pe_ratio: 30, eps: 6.5,
      week52_high: 220, week52_low: 150, volume: 50e6, dividend_yield: 0.5,
    };
    const { container } = render(<OverviewTab ticker="AAPL" />);
    const matches = screen.getAllByText(/10\.0%/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".text-emerald-600")).toBeTruthy();
  });
});
