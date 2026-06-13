import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      empty: "No reversals",
    },
  },
  Trending: { week: "1W", month: "1M", quarter: "3M" },
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
  const fetcher = vi
    .fn()
    .mockImplementation(async (_url: string) => ({ window_days: 30, items }));
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <StanceFlips />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return { fetcher };
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

  it("links prev/curr stance badges to the internal video page with ?ticker", async () => {
    renderFlips([flip]);
    const links = await screen.findAllByRole("link");
    const videoLinks = links.filter((a) =>
      (a.getAttribute("href") ?? "").includes("/videos/"),
    );
    expect(videoLinks.length).toBeGreaterThanOrEqual(2);
    for (const a of videoLinks) {
      expect(a.getAttribute("href")).toContain("ticker=");
      expect(a.getAttribute("href")).not.toContain("youtube.com");
    }
  });

  it("shows empty message but keeps heading + pills when there are no flips", async () => {
    renderFlips([]);
    expect(await screen.findByText("No reversals")).toBeInTheDocument();
    // heading + pills still rendered so the window can be changed
    expect(screen.getByText("Stance flips")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1W" })).toBeInTheDocument();
  });

  it("refetches with days=7 when the 1W window pill is clicked", async () => {
    const { fetcher } = renderFlips([flip]);
    await screen.findByText("Alpha");
    // default window is 30d
    expect(
      fetcher.mock.calls.some(([u]: string[]) => u.includes("days=30")),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "1W" }));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([u]: string[]) => u.includes("days=7")),
      ).toBe(true),
    );
  });
});
