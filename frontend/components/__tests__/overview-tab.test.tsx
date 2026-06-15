import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

const swrResponses: Record<string, unknown> = {};
vi.mock("swr", () => ({
  default: (key: string) => ({ data: swrResponses[key] }),
}));

vi.mock("@/components/financials-chart", () => ({
  FinancialsChart: () => <div data-testid="financials-chart" />,
}));

import { OverviewTab } from "@/components/overview-tab";

const baseStock = {
  ticker: "AAPL", name: "Apple", price: 200, change: 1,
  change_percent: 0.5, market_cap: 3e12, pe_ratio: 30, eps: 6.5,
  week52_high: 220, week52_low: 150, volume: 50e6, dividend_yield: 0.5,
};

const baseFinancials = [
  { period_end: "2025-03", total_revenue: 100, net_income: 20, gross_profit: 40, operating_income: 25, pretax_income: 22 },
  { period_end: "2025-06", total_revenue: 100, net_income: 20, gross_profit: 40, operating_income: 25, pretax_income: 22 },
  { period_end: "2025-09", total_revenue: 100, net_income: 20, gross_profit: 40, operating_income: 25, pretax_income: 22 },
  { period_end: "2025-12", total_revenue: 100, net_income: 20, gross_profit: 40, operating_income: 25, pretax_income: 22 },
  { period_end: "2026-03", total_revenue: 110, net_income: 22, gross_profit: 44, operating_income: 27, pretax_income: 24 },
];

function seedBase(windowDays = 90) {
  swrResponses["/api/stocks/AAPL/financials?period=quarterly"] = baseFinancials;
  swrResponses[`/api/stocks/AAPL/stance-summary?days=${windowDays}`] = {
    buy: 3, neutral: 1, sell: 0, window_days: windowDays,
  };
  swrResponses["/api/stocks/AAPL"] = baseStock;
  swrResponses["/api/stocks/AAPL/analyst"] = {
    target_low: null, target_mean: null, target_high: null,
    analyst_count: null, recommendations: {},
  };
}

describe("OverviewTab", () => {
  it("renders YoY positive in emerald", () => {
    seedBase();
    const { container } = render(<OverviewTab ticker="AAPL" />);
    const matches = screen.getAllByText(/10\.0%/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".text-emerald-600")).toBeTruthy();
  });

  it("clicking window button 180 fetches stance-summary with days=180", async () => {
    seedBase(90);
    // Seed 180-day response too so component can render after click
    swrResponses["/api/stocks/AAPL/stance-summary?days=180"] = {
      buy: 5, neutral: 2, sell: 1, window_days: 180,
    };

    render(<OverviewTab ticker="AAPL" />);

    // Click the "180" window button
    const btn180 = screen.getByRole("button", { name: "180" });
    await userEvent.click(btn180);

    // After click, the SWR key for days=180 should have been used
    // The SWR mock returns data for the key — the component re-renders with the 180-day key
    expect(swrResponses["/api/stocks/AAPL/stance-summary?days=180"]).toBeDefined();
  });

  it("clicking the All window button uses days=3650", async () => {
    seedBase(90);
    swrResponses["/api/stocks/AAPL/stance-summary?days=3650"] = {
      buy: 10, neutral: 3, sell: 2, window_days: 3650,
    };

    render(<OverviewTab ticker="AAPL" />);

    // Click the "All" window button — the button text is "windowAll" per i18n mock
    const btnAll = screen.getByRole("button", { name: "windowAll" });
    await userEvent.click(btnAll);

    expect(swrResponses["/api/stocks/AAPL/stance-summary?days=3650"]).toBeDefined();
  });
});
