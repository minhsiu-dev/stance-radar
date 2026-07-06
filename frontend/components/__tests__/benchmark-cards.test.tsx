import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { BenchmarkCards } from "@/components/benchmark-cards";

const messages = {
  Dashboard: {
    benchmarks: {
      title: "Benchmarks",
      loadError: "Failed: {message}",
    },
  },
};

// Sparkline fetches /api/stocks/{ticker}/candles through the same global fetcher,
// so it must be key-aware: candle URLs resolve to [] (harmless empty stub).
function keyAware(payload: () => Promise<unknown>) {
  return (url: string) => (url.includes("/candles") ? Promise.resolve([]) : payload());
}

function wrap(payload: () => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher: keyAware(payload), provider: () => new Map() }}>
        <BenchmarkCards />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

const changes = { "1d": 0.8, "5d": 2.1, "1m": 4.3, "3m": -1.2, "6m": 9.8, ytd: 6.4, "1y": 18.2 };

describe("BenchmarkCards", () => {
  it("renders VOO, QQQ and VT cards with range chips", async () => {
    wrap(vi.fn().mockResolvedValue({
      ranges: ["1d", "5d", "1m", "3m", "6m", "ytd", "1y"],
      items: [
        { ticker: "VOO", price: 512.3, changes },
        { ticker: "QQQ", price: 478.91, changes },
        { ticker: "VT", price: 118.02, changes },
      ],
    }));
    expect(await screen.findByText("VOO")).toBeInTheDocument();
    expect(screen.getByText("QQQ")).toBeInTheDocument();
    expect(screen.getByText("VT")).toBeInTheDocument();
    expect(screen.getAllByTestId("perf-card").length).toBe(3);
    expect(screen.getAllByText("+4.3%").length).toBe(3); // 1m chip on each
    for (const el of screen.getAllByText("-1.2%")) {
      expect(el).toHaveClass("text-rose-600");
    }
  });

  it("shows an error message when the fetch fails", async () => {
    wrap(vi.fn().mockRejectedValue(new Error("boom")));
    expect(await screen.findByText("Failed: boom")).toBeInTheDocument();
  });
});
