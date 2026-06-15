import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { GrowthMargins } from "@/components/growth-margins";
import type { FinancialReport } from "@/lib/types";

const messages = {
  Stock: {
    growth: {
      title: "Growth (latest quarter)",
      metric: "Metric", value: "Value", qoq: "QoQ", yoy: "YoY",
      revenue: "Revenue", grossProfit: "Gross profit",
      operatingIncome: "Operating income", netIncome: "Net income",
      marginsTitle: "Margin trends",
      grossMargin: "Gross", operatingMargin: "Operating", netMargin: "Net",
    },
  },
};

function report(i: number): FinancialReport {
  const revenue = (100 + i * 10) * 1e9;
  return {
    period_end: `202${Math.floor(i / 4) + 4}-0${(i % 4) * 3 + 1}-30`,
    total_revenue: revenue,
    gross_profit: revenue * 0.4,
    operating_income: revenue * 0.25,
    pretax_income: revenue * 0.22,
    net_income: revenue * 0.2,
  };
}

it("computes QoQ and YoY for the latest quarter", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GrowthMargins reports={[...Array(8)].map((_, i) => report(i))} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("Growth (latest quarter)")).toBeInTheDocument();
  // The fixture's four metrics grow proportionally → four rows share the same value, use getAllByText
  expect(screen.getAllByText("+6.3%").length).toBe(4);   // 170/160 - 1
  expect(screen.getAllByText("+30.8%").length).toBe(4);  // 170/130 - 1
  expect(screen.getByText("Margin trends")).toBeInTheDocument();
});

describe("GrowthMargins edge cases", () => {
  it("renders null when reports is empty", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <GrowthMargins reports={[]} />
      </NextIntlClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});
