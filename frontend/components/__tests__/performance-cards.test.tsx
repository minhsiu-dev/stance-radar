import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PerformanceCards } from "@/components/performance-cards";

const messages = {
  Dashboard: {
    performance: {
      portfolio: "My portfolio",
      empty: "No holdings yet",
      emptyCta: "Add transactions",
      loadError: "Failed: {message}",
    },
  },
};

// Control hideHoldings per test
const privacy = { hideHoldings: false, ready: true, toggle: vi.fn() };
vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => privacy,
}));

// VOO/QQQ cards render a <Sparkline> that fetches /api/stocks/{ticker}/candles
// through the same global SWR fetcher, so the fetcher must be key-aware: candle
// URLs resolve to [] (the sparkline then renders its harmless empty stub).
function keyAware(summary: () => Promise<unknown>) {
  return (url: string) => (url.includes("/candles") ? Promise.resolve([]) : summary());
}

function wrap(summary: () => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher: keyAware(summary), provider: () => new Map() }}>
        <PerformanceCards />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  privacy.hideHoldings = false;
  privacy.ready = true;
});

const changes = { "1d": 0.8, "5d": 2.1, "1m": 4.3, "3m": -1.2, "6m": 9.8, ytd: 6.4, "1y": 18.2 };

describe("PerformanceCards", () => {
  it("renders portfolio, VOO and QQQ cards with range chips", async () => {
    wrap(vi.fn().mockResolvedValue({
      ranges: ["1d", "5d", "1m", "3m", "6m", "ytd", "1y"],
      portfolio: { total_value: 128430.5, changes },
      voo: { price: 512.3, changes },
      qqq: { price: 478.91, changes },
    }));
    expect(await screen.findByText("My portfolio")).toBeInTheDocument();
    expect(screen.getByText("VOO")).toBeInTheDocument();
    expect(screen.getByText("QQQ")).toBeInTheDocument();
    expect(screen.getAllByText("+4.3%").length).toBe(3); // 1m chip on each card
    expect(screen.getAllByText("-1.2%").length).toBe(3);
    for (const el of screen.getAllByText("+4.3%")) {
      expect(el).toHaveClass("text-emerald-600");
    }
    for (const el of screen.getAllByText("-1.2%")) {
      expect(el).toHaveClass("text-rose-600");
    }
  });

  it("shows empty-portfolio hint when portfolio is null", async () => {
    wrap(vi.fn().mockResolvedValue({
      ranges: ["1d", "5d", "1m", "3m", "6m", "ytd", "1y"],
      portfolio: null,
      voo: { price: 512.3, changes },
      qqq: { price: 478.91, changes },
    }));
    expect(await screen.findByText("No holdings yet")).toBeInTheDocument();
    expect(screen.getByText("VOO")).toBeInTheDocument();
  });

  it("omits the portfolio card when hideHoldings is true; VOO and QQQ still render", async () => {
    privacy.hideHoldings = true;
    wrap(vi.fn().mockResolvedValue({
      ranges: ["1d", "5d", "1m", "3m", "6m", "ytd", "1y"],
      portfolio: { total_value: 128430.5, changes },
      voo: { price: 512.3, changes },
      qqq: { price: 478.91, changes },
    }));
    expect(await screen.findByText("VOO")).toBeInTheDocument();
    expect(screen.getByText("QQQ")).toBeInTheDocument();
    // Portfolio card must be absent
    expect(screen.queryByText("My portfolio")).toBeNull();
    // Only 2 perf-cards (VOO + QQQ)
    expect(screen.getAllByTestId("perf-card").length).toBe(2);
    // Real percentage values for VOO/QQQ still visible
    expect(screen.getAllByText("+4.3%").length).toBe(2);
    expect(screen.getAllByText("-1.2%").length).toBe(2);
  });

  it("shows all three cards when hideHoldings is false", async () => {
    privacy.hideHoldings = false;
    wrap(vi.fn().mockResolvedValue({
      ranges: ["1d", "5d", "1m", "3m", "6m", "ytd", "1y"],
      portfolio: { total_value: 128430.5, changes },
      voo: { price: 512.3, changes },
      qqq: { price: 478.91, changes },
    }));
    expect(await screen.findByText("My portfolio")).toBeInTheDocument();
    expect(screen.getByText("VOO")).toBeInTheDocument();
    expect(screen.getByText("QQQ")).toBeInTheDocument();
    expect(screen.getAllByTestId("perf-card").length).toBe(3);
    // Real portfolio value visible
    expect(screen.getByText("$128,430.5")).toBeInTheDocument();
  });
});
