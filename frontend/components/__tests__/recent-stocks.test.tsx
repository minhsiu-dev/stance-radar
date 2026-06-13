import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { RecentStocks } from "@/components/recent-stocks";

const messages = { Dashboard: { recentStocks: { title: "Recently discussed" } } };

function wrap(fetcher: () => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <RecentStocks />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

const STOCKS = [
  { ticker: "NVDA", mention_count: 7, last_mentioned_at: "2026-06-11T00:00:00Z" },
  { ticker: "AAPL", mention_count: 5, last_mentioned_at: "2026-06-10T00:00:00Z" },
];

describe("RecentStocks", () => {
  it("renders each stock as a link to its stock page, in API order", async () => {
    wrap(vi.fn().mockResolvedValue(STOCKS));
    const nvda = await screen.findByRole("link", { name: /NVDA/ });
    expect(nvda.getAttribute("href")).toContain("/stocks/NVDA");
    const aapl = screen.getByRole("link", { name: /AAPL/ });
    expect(aapl.getAttribute("href")).toContain("/stocks/AAPL");
    expect(aapl.getAttribute("href")).not.toContain("ticker=");

    const pills = screen.getAllByTestId("recent-stock-pill").map((el) => el.textContent);
    expect(pills[0]).toContain("NVDA");
    expect(pills[1]).toContain("AAPL");
  });

  it("renders nothing when the API returns an empty array", async () => {
    const { container } = wrap(vi.fn().mockResolvedValue([]));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid='recent-stock-pill']")).toBeNull();
  });
});
