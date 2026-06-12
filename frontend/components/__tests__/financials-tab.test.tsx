import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

const swrCalls: string[] = [];
vi.mock("swr", () => ({
  default: (key: string) => {
    swrCalls.push(key);
    return {
      data: [
        {
          period_end: "2025-12",
          total_revenue: 100,
          gross_profit: 40,
          operating_income: 25,
          pretax_income: 22,
          net_income: 20,
        },
      ],
      isLoading: false,
    };
  },
}));

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ChartLegend: () => null,
  ChartLegendContent: () => null,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));
vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { FinancialsTab } from "@/components/financials-tab";

describe("FinancialsTab", () => {
  it("fetches quarterly by default and switches to annual", () => {
    render(<FinancialsTab ticker="AAPL" />);
    expect(swrCalls.some((k) => k.includes("period=quarterly"))).toBe(true);
    fireEvent.click(screen.getByText("annual"));
    expect(swrCalls.some((k) => k.includes("period=annual"))).toBe(true);
  });
});
