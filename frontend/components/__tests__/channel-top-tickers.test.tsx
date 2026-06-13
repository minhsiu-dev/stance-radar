import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ChannelTopTickers } from "@/components/channel-top-tickers";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = {
  ChannelDetail: {
    topTickers: {
      title: "Most mentioned",
      empty: "No data yet",
      ticker: "Ticker",
      mentions: "Mentions",
      videoCount: "{count} videos",
      distribution: "Stance mix",
      latest: "Latest",
    },
  },
  Stock: {
    stance: { buy: "Buy", sell: "Sell", neutral: "Neutral" },
  },
};

function renderRows(rows: unknown[]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChannelTopTickers
        rows={rows as Parameters<typeof ChannelTopTickers>[0]["rows"]}
      />
    </NextIntlClientProvider>,
  );
}

describe("ChannelTopTickers", () => {
  it("renders a row with link, counts, proportional stance bar and latest stance", () => {
    renderRows([
      {
        ticker: "NVDA",
        videos: 6,
        buy: 3,
        neutral: 1,
        sell: 2,
        latest_stance: "sell",
        latest_date: "2026-06-08",
      },
    ]);

    // ticker links to the stock page
    const link = screen.getByRole("link", { name: "NVDA" });
    expect(link.getAttribute("href")).toContain("/stocks/NVDA");

    // video count
    expect(screen.getByText("6 videos")).toBeInTheDocument();

    // stance distribution bar: 3/1/2 → 50% / 16.7% / 33.3%
    const bar = screen.getByTestId("stance-bar-NVDA");
    const widths = Array.from(bar.children).map((el) =>
      parseFloat((el as HTMLElement).style.width),
    );
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeCloseTo(50, 1);
    expect(widths[1]).toBeCloseTo(16.7, 1);
    expect(widths[2]).toBeCloseTo(33.3, 1);

    // latest stance badge + date
    expect(screen.getByText(/NVDA · Sell/)).toBeInTheDocument();
    expect(screen.getByText("2026-06-08")).toBeInTheDocument();
  });

  it("shows the empty state when there are no rows", () => {
    renderRows([]);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });
});
