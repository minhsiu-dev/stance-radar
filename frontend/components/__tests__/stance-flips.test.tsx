import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { StanceFlips } from "@/components/stance-flips";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = {
  Dashboard: {
    flips: {
      title: "Stance flips",
      window: "last {days} days",
      reversal: "Reversal",
      reversalHint: "flipped between buy and sell",
    },
  },
};

const flip = {
  channel_id: "UC_a",
  channel_title: "Alpha",
  channel_thumbnail: "",
  ticker: "NVDA",
  direction: "bearish",
  is_reversal: true,
  prev: {
    video_id: "v1", video_title: "old", stance: "buy",
    summary: "bullish then", published_at: "2026-05-20T00:00:00Z",
  },
  curr: {
    video_id: "v2", video_title: "new", stance: "sell",
    summary: "bearish now", published_at: "2026-06-10T00:00:00Z",
  },
};

function renderFlips(items: unknown[]) {
  const fetcher = vi.fn().mockResolvedValue({ window_days: 30, items });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <StanceFlips />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("StanceFlips", () => {
  it("renders reversal flip with channel, ticker and both stances", async () => {
    renderFlips([flip]);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getByText("Buy")).toBeInTheDocument();
    expect(screen.getByText("Sell")).toBeInTheDocument();
    expect(screen.getByText("Reversal")).toBeInTheDocument();
  });

  it("renders nothing when there are no flips", async () => {
    renderFlips([]);
    // loading skeleton 會先短暫顯示標題;等資料 resolve 後 section 整個不顯示
    await waitFor(() =>
      expect(screen.queryByText("Stance flips")).not.toBeInTheDocument(),
    );
  });
});
