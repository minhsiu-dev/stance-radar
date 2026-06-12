import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { ChannelLeaderboard } from "@/components/channel-leaderboard";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = {
  Dashboard: {
    leaderboard: {
      title: "Channel accuracy leaderboard",
      subtitle: "{days}d after each call · vs {benchmark}",
      channel: "Channel",
      avgAlpha: "Avg excess return",
      buyWinRate: "Buy win rate",
      sellWinRate: "Sell win rate",
      calls: "Calls (realized/total)",
    },
  },
};

const item = {
  channel_id: "UC_a",
  channel_title: "Alpha",
  channel_thumbnail: "",
  calls_total: 5,
  realized_30d: 4,
  avg_call_alpha_30d: 2.5,
  buy: { count: 3, avg_return: 4.1, avg_alpha: 2.5, win_rate: 66.7 },
  sell: { count: 1, avg_return: -1.0, avg_alpha: null, win_rate: 100.0 },
};

function renderBoard(items: unknown[]) {
  const fetcher = vi.fn().mockResolvedValue({
    horizon_days: 30,
    benchmark: "SPY",
    items,
  });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <ChannelLeaderboard />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("ChannelLeaderboard", () => {
  it("renders channel rows with alpha and win rates", async () => {
    renderBoard([item]);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("+2.50%")).toBeInTheDocument();
    expect(screen.getByText("66.7%")).toBeInTheDocument();
    expect(screen.getByText("4/5")).toBeInTheDocument();
  });

  it("renders nothing when no channels have calls", async () => {
    renderBoard([]);
    // loading skeleton 會先短暫顯示標題;等資料 resolve 後 section 整個不顯示
    await waitFor(() =>
      expect(
        screen.queryByText("Channel accuracy leaderboard"),
      ).not.toBeInTheDocument(),
    );
  });
});
