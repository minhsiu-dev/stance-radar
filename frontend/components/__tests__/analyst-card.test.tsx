import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { AnalystCard } from "@/components/analyst-card";
import type { AnalystData } from "@/lib/types";

const messages = {
  Stock: {
    analyst: {
      title: "Analyst targets",
      count: "{count} analysts",
      low: "Low",
      mean: "Mean",
      high: "High",
      upside: "vs price",
      strongBuy: "Strong buy",
      buy: "Buy",
      hold: "Hold",
      sell: "Sell",
      strongSell: "Strong sell",
    },
  },
};

const fullData: AnalystData = {
  target_low: 100,
  target_mean: 150,
  target_high: 200,
  analyst_count: 30,
  recommendations: { strongBuy: 10, buy: 12, hold: 6, sell: 1, strongSell: 1 },
};

const emptyData: AnalystData = {
  target_low: null,
  target_mean: null,
  target_high: null,
  analyst_count: null,
  recommendations: {},
};

function wrap(data: AnalystData, price: number | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AnalystCard data={data} price={price} />
    </NextIntlClientProvider>,
  );
}

describe("AnalystCard", () => {
  it("renders mean price, upside, count, and rating bar for full data", () => {
    wrap(fullData, 120);

    // mean target price rendered
    expect(screen.getByText("150")).toBeInTheDocument();

    // upside: (150/120 - 1) * 100 = 25.0%
    expect(screen.getByText("+25.0%")).toBeInTheDocument();

    // analyst count
    expect(screen.getByText(/30 analysts/)).toBeInTheDocument();

    // rating bar testid
    expect(screen.getByTestId("rating-bar")).toBeInTheDocument();
  });

  it("renders nothing when target_mean is null", () => {
    const { container } = wrap(emptyData, 120);
    expect(container.firstChild).toBeNull();
  });
});
