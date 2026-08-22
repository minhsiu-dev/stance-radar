import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { StockCard } from "@/components/stock-card";
import type { TrendingStock } from "@/lib/types";

const messages = {
  Dashboard: {
    recentStocks: {
      channelCount: "{count} channels",
      scoreBreakdown: "{channels} channels · {days}d ago",
      scoreBreakdownNoBuys: "No buy calls yet",
      scoreBreakdownWeighted: "{channels} channels · {days}d ago · {winRate}% win rate",
    },
  },
  Stock: {
    stance: { buy: "Buy", neutral: "Neutral", sell: "Sell", new: "New", repeat: "Repeat" },
  },
};

const zone = (count: number) => ({
  count,
  avatars: Array.from({ length: Math.min(count, 3) }, (_, i) => ({
    title: `Ch${i}`,
    thumbnail_url: "",
  })),
});

const BASE: TrendingStock = {
  ticker: "NVDA",
  channel_count: 4,
  // Deliberately different from channel_count: catches a regression where the
  // breakdown line reads the wrong field (it must describe watch_score, which is
  // buy-only, not every channel that took any stance).
  buy_channel_count: 3,
  video_count: 4,
  watch_score: 3.7994,
  last_mentioned_at: "2026-08-21T00:00:00Z",
  last_buy_at: new Date(Date.now() - 6 * 86400_000).toISOString(),
  channel_win_rate_avg: null,
  stances: { buy: zone(4), neutral: zone(0), sell: zone(0) },
  buckets: [],
};

function wrap(s: TrendingStock, showScore?: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StockCard s={s} showScore={showScore} />
    </NextIntlClientProvider>,
  );
}

describe("StockCard", () => {
  it("keeps the channel-count badge and hides the score by default", () => {
    wrap(BASE);
    expect(screen.queryByTestId("watch-score")).toBeNull();
    expect(screen.queryByTestId("score-breakdown")).toBeNull();
    expect(screen.getByText("4 channels")).toBeInTheDocument();
  });

  it("shows the score and what it is made of when asked", () => {
    wrap(BASE, true);
    expect(screen.getByTestId("watch-score")).toHaveTextContent("3.8");
    const breakdown = screen.getByTestId("score-breakdown");
    // buy_channel_count (3), not channel_count (4) — the breakdown describes the
    // score, and the score only counts channels that bought.
    expect(breakdown).toHaveTextContent("3 channels");
    expect(breakdown).not.toHaveTextContent("4 channels");
    expect(breakdown).toHaveTextContent("6d ago");
  });

  it("still renders the breakdown line, with an explanatory string, when nothing has been recommended", () => {
    wrap({ ...BASE, watch_score: 0, last_buy_at: null }, true);
    expect(screen.getByTestId("watch-score")).toHaveTextContent("0.0");
    // The paragraph must always render when showScore is true (never conditionally
    // on last_buy_at) — otherwise cards with/without a buy call get different
    // heights inside the grid, since the card root stacks children top-down.
    expect(screen.getByTestId("score-breakdown")).toHaveTextContent("No buy calls yet");
  });

  it("adds the weighted win rate to the breakdown when present", () => {
    wrap({ ...BASE, channel_win_rate_avg: 61.4 }, true);
    expect(screen.getByTestId("score-breakdown")).toHaveTextContent("61% win rate");
  });

  it("omits the win rate from the breakdown when there is none", () => {
    wrap({ ...BASE, channel_win_rate_avg: null }, true);
    expect(screen.getByTestId("score-breakdown")).not.toHaveTextContent("%");
  });
});
