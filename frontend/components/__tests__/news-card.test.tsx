import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { NewsCard } from "@/components/news-card";

const messages = {
  Dashboard: {
    news: { title: "Holdings news", generalTitle: "Market news", empty: "No news" },
  },
};

function wrap(fetcher: () => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <NewsCard />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("NewsCard", () => {
  it("renders items with publisher and ticker badge", async () => {
    wrap(vi.fn().mockResolvedValue({
      scope: "holdings",
      items: [{
        ticker: "AAPL", title: "Apple ships AI", url: "https://x.test/1",
        publisher: "Reuters", published_at: "2026-06-12T01:00:00+00:00",
      }],
    }));
    expect(await screen.findByText("Holdings news")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Apple ships AI/ })).toHaveAttribute(
      "href", "https://x.test/1",
    );
    expect(screen.getByText("Reuters")).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("uses general title and renders nothing-state when empty", async () => {
    wrap(vi.fn().mockResolvedValue({ scope: "general", items: [] }));
    expect(await screen.findByText("Market news")).toBeInTheDocument();
    expect(screen.getByText("No news")).toBeInTheDocument();
  });
});
