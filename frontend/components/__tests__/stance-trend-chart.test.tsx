import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { StanceTrendChart } from "@/components/stance-trend-chart";
import type { StanceBucket } from "@/lib/types";

const messages = {
  Stock: {
    stance: { buy: "Buy", neutral: "Neutral", sell: "Sell", new: "New", repeat: "Repeat" },
  },
};

function wrap(buckets: StanceBucket[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StanceTrendChart buckets={buckets} />
    </NextIntlClientProvider>,
  );
}

const B = (over: Partial<StanceBucket>): StanceBucket => ({
  start: "2026-06-01T00:00:00+00:00", end: "2026-06-08T00:00:00+00:00",
  granularity: "week",
  buy_new: 0, buy_repeat: 0,
  neutral_new: 0, neutral_repeat: 0,
  sell_new: 0, sell_repeat: 0,
  ...over,
});

describe("StanceTrendChart", () => {
  it("renders a recharts stacked bar chart container when there is data", () => {
    const { container } = wrap([B({ buy_new: 2 }), B({ sell_repeat: 1 })]);
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
