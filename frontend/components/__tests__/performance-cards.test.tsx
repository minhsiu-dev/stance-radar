import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PrivacyProvider } from "@/components/privacy-provider";
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
        <PrivacyProvider>
          <PerformanceCards />
        </PrivacyProvider>
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => localStorage.clear());

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

  it("masks the portfolio headline when privacy mode is on", async () => {
    localStorage.setItem("stance-radar-hide-amounts", "true");
    wrap(vi.fn().mockResolvedValue({
      ranges: ["1d", "5d", "1m", "3m", "6m", "ytd", "1y"],
      portfolio: { total_value: 128430.5, changes },
      voo: { price: 512.3, changes },
      qqq: { price: 478.91, changes },
    }));
    expect(await screen.findByText("My portfolio")).toBeInTheDocument();
    // 組合 headline 被遮罩(百分比也遮 → 可能有多個 ••••)
    expect(screen.getAllByText("••••").length).toBeGreaterThan(0);
    expect(screen.queryByText(/128,430/)).toBeNull();
    // VOO/QQQ are public market prices, not masked
    expect(screen.getByText("$512.3")).toBeInTheDocument();
    expect(screen.getByText("$478.91")).toBeInTheDocument();  // QQQ price visible
  });

  it("masks the portfolio card only — VOO/QQQ percentages stay visible when privacy is on", async () => {
    localStorage.setItem("stance-radar-hide-amounts", "true");
    wrap(vi.fn().mockResolvedValue({
      ranges: ["1d", "5d", "1m", "3m", "6m", "ytd", "1y"],
      portfolio: { total_value: 128430.5, changes },
      voo: { price: 512.3, changes },
      qqq: { price: 478.91, changes },
    }));
    await screen.findByText("My portfolio");
    // 隱私只遮投組:portfolio headline + 其 1D/各區間百分比 → 多個 ••••
    expect(screen.getAllByText("••••").length).toBeGreaterThan(0);
    expect(screen.queryByText(/128,430/)).toBeNull();
    // 但 VOO/QQQ 為公開市場數字,兩張卡的 1m 百分比依舊顯示真實數值(非遮罩)
    expect(screen.getAllByText("+4.3%").length).toBe(2);
    expect(screen.getAllByText("-1.2%").length).toBe(2);
    for (const el of screen.getAllByText("+4.3%")) {
      expect(el).toHaveClass("text-emerald-600");
    }
  });
});
