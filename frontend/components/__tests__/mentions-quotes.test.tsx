import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { MentionsQuotes } from "@/components/mentions-quotes";
import type { VideoDetailGroup } from "@/lib/types";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = { VideoDetail: { noMentions: "No mentions" } };

const GROUPS: VideoDetailGroup[] = [
  {
    ticker: "AAPL", stance: "buy", summary: "Bullish on AAPL", confidence: "high",
    mentions: [
      { start_seconds: 134, quote: "still going up", excerpt: "raw words", stance: "buy", confidence: "high", time_horizon: null, is_conditional: null, condition: null },
      { start_seconds: 662, quote: "watch earnings", excerpt: null, stance: "neutral", confidence: null, time_horizon: null, is_conditional: null, condition: null },
    ],
  },
  {
    ticker: "TSLA", stance: "sell", summary: "Too expensive", confidence: "medium",
    mentions: [
      { start_seconds: 330, quote: "valuation too high", excerpt: null, stance: "sell", confidence: "medium", time_horizon: null, is_conditional: null, condition: null },
    ],
  },
];

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>,
  );
}

describe("MentionsQuotes", () => {
  it("lists every quote ordered by ascending timestamp across tickers", () => {
    wrap(<MentionsQuotes groups={GROUPS} channelId="c1" onSeek={() => {}} />);
    const order = screen
      .getAllByText(/still going up|valuation too high|watch earnings/)
      .map((e) => e.textContent);
    expect(order).toEqual(["still going up", "valuation too high", "watch earnings"]);
    expect(screen.getByRole("button", { name: "2:14" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5:30" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "11:02" })).toBeInTheDocument();
  });

  it("calls onSeek with the mention start_seconds on timestamp click", async () => {
    const onSeek = vi.fn();
    wrap(<MentionsQuotes groups={GROUPS} channelId="c1" onSeek={onSeek} />);
    await userEvent.click(screen.getByRole("button", { name: "5:30" }));
    expect(onSeek).toHaveBeenCalledWith(330);
  });

  it("links tickers to the stock page filtered by this channel", () => {
    wrap(<MentionsQuotes groups={GROUPS} channelId="c1" onSeek={() => {}} />);
    const links = screen.getAllByRole("link", { name: "AAPL" });
    for (const l of links) {
      expect(l.getAttribute("href")).toBe("/stocks/AAPL?channel=c1");
    }
  });

  it("shows the empty state when there are no groups", () => {
    wrap(<MentionsQuotes groups={[]} channelId="c1" onSeek={() => {}} />);
    expect(screen.getByText("No mentions")).toBeInTheDocument();
  });

  it("shows the empty state when groups exist but have no mentions", () => {
    const noMentions = GROUPS.map((g) => ({ ...g, mentions: [] }));
    wrap(<MentionsQuotes groups={noMentions} channelId="c1" onSeek={() => {}} />);
    expect(screen.getByText("No mentions")).toBeInTheDocument();
  });

  it("renders the excerpt quote via a hover trigger and plain quotes without one", () => {
    wrap(<MentionsQuotes groups={GROUPS} channelId="c1" onSeek={() => {}} />);
    // mention with excerpt -> hover trigger span (cursor-help)
    expect(screen.getByText("still going up").className).toContain("cursor-help");
    // mention without excerpt -> plain span
    expect(screen.getByText("watch earnings").className).not.toContain("cursor-help");
  });
});
