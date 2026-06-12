import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { TrendingStocks } from "@/components/trending-stocks";

const messages = { Dashboard: { trending: { title: "Recently mentioned" } } };

function wrap(ui: React.ReactNode, fetcher: () => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>{ui}</SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("TrendingStocks", () => {
  it("renders pills in API order", async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { ticker: "NVDA", mention_count: 7, last_mentioned_at: "2026-06-11T00:00:00Z" },
      { ticker: "AAPL", mention_count: 5, last_mentioned_at: "2026-06-10T00:00:00Z" },
    ]);
    wrap(<TrendingStocks />, fetcher);
    expect(await screen.findByText("NVDA")).toBeInTheDocument();
    const tickers = screen
      .getAllByTestId("trending-pill")
      .map((el) => el.textContent);
    expect(tickers[0]).toContain("NVDA");
    expect(tickers[1]).toContain("AAPL");
  });

  it("renders nothing when API returns empty array", async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const { container } = wrap(<TrendingStocks />, fetcher);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid='trending-pill']")).toBeNull();
  });
});
