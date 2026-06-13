import { render, screen, fireEvent } from "@testing-library/react";
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

const STOCKS = [
  { ticker: "NVDA", mention_count: 7, last_mentioned_at: "2026-06-11T00:00:00Z" },
  { ticker: "AAPL", mention_count: 5, last_mentioned_at: "2026-06-10T00:00:00Z" },
];

describe("TrendingStocks", () => {
  it("renders pills in API order", async () => {
    const fetcher = vi.fn().mockResolvedValue(STOCKS);
    wrap(<TrendingStocks selected={null} onSelect={vi.fn()} />, fetcher);
    expect(await screen.findByText("NVDA")).toBeInTheDocument();
    const tickers = screen
      .getAllByTestId("trending-pill")
      .map((el) => el.textContent);
    expect(tickers[0]).toContain("NVDA");
    expect(tickers[1]).toContain("AAPL");
  });

  it("renders nothing when API returns empty array", async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const { container } = wrap(
      <TrendingStocks selected={null} onSelect={vi.fn()} />,
      fetcher,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid='trending-pill']")).toBeNull();
  });

  it("calls onSelect with ticker on click and null when active pill clicked", async () => {
    const fetcher = vi.fn().mockResolvedValue(STOCKS);
    const onSelect = vi.fn();
    wrap(<TrendingStocks selected={null} onSelect={onSelect} />, fetcher);
    fireEvent.click(await screen.findByRole("button", { name: /NVDA/ }));
    expect(onSelect).toHaveBeenLastCalledWith("NVDA");

    onSelect.mockClear();
    wrap(<TrendingStocks selected="NVDA" onSelect={onSelect} />, fetcher);
    // 等第二次 render 的資料載入完成(active pill 出現)再點
    const active = await screen.findByRole("button", {
      name: /NVDA/,
      pressed: true,
    });
    fireEvent.click(active);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("highlights the active pill and dims the rest", async () => {
    const fetcher = vi.fn().mockResolvedValue(STOCKS);
    wrap(<TrendingStocks selected="NVDA" onSelect={vi.fn()} />, fetcher);
    const nvda = await screen.findByRole("button", { name: /NVDA/ });
    const aapl = screen.getByRole("button", { name: /AAPL/ });
    expect(nvda).toHaveAttribute("aria-pressed", "true");
    expect(nvda.className).toContain("border-primary");
    expect(aapl).toHaveAttribute("aria-pressed", "false");
    expect(aapl.className).toContain("opacity-40");
    expect(nvda.className).not.toContain("opacity-40");
  });
});
