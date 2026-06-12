import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/components/price-chart", () => ({
  PriceChart: () => <div data-testid="chart" />,
}));
vi.mock("@/components/stock-header", () => ({
  StockHeader: () => <div data-testid="header" />,
}));
vi.mock("@/components/overview-tab", () => ({
  OverviewTab: () => <div data-testid="overview" />,
}));
vi.mock("@/components/mentions-tab", () => ({
  MentionsTab: () => <div data-testid="mentions" />,
}));
vi.mock("@/components/financials-tab", () => ({
  FinancialsTab: () => <div data-testid="financials" />,
}));

import { StockView } from "@/components/stock-view";

describe("StockView", () => {
  it("renders chart above tabs and overview by default", () => {
    render(<StockView ticker="AAPL" />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByTestId("overview")).toBeInTheDocument();
  });

  it("switches to Mentions tab", () => {
    render(<StockView ticker="AAPL" />);
    fireEvent.click(screen.getByRole("tab", { name: "mentions" }));
    expect(screen.getByTestId("mentions")).toBeInTheDocument();
  });
});
