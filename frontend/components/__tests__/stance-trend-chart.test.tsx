import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { StanceTrendChart } from "@/components/stance-trend-chart";
import type { StanceBucket } from "@/lib/types";

const messages = { Stock: { stance: { buy: "Buy", neutral: "Neutral", sell: "Sell" } } };

function wrap(buckets: StanceBucket[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StanceTrendChart buckets={buckets} />
    </NextIntlClientProvider>,
  );
}

const B = (over: Partial<StanceBucket>): StanceBucket => ({
  start: "2026-06-01T00:00:00+00:00", end: "2026-06-08T00:00:00+00:00",
  granularity: "week", buy: 0, neutral: 0, sell: 0, ...over,
});

describe("StanceTrendChart", () => {
  it("renders a recharts stacked bar chart container when there is data", () => {
    const { container } = wrap([B({ buy: 2 }), B({ sell: 1 })]);
    // shadcn ChartContainer renders a div with data-slot="chart"
    expect(container.querySelector('[data-slot="chart"]')).toBeInTheDocument();
    // recharts renders a responsive container div (SVG is not rendered in jsdom due to zero dimensions)
    expect(container.querySelector(".recharts-responsive-container, svg")).toBeTruthy();
  });

  it("renders nothing when all buckets are empty", () => {
    const { container } = wrap([B({}), B({})]);
    expect(container.firstChild).toBeNull();
  });
});
