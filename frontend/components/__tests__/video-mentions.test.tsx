import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { VideoMentions } from "@/components/video-mentions";
import type { VideoDetailGroup } from "@/lib/types";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = {
  VideoDetail: {
    noMentions: "No mentions",
    byStock: "By stock",
    quotesByTime: "Quotes (in order)",
  },
};

const GROUPS: VideoDetailGroup[] = [
  {
    ticker: "AAPL", stance: "buy", summary: "Bullish on AAPL", confidence: "high",
    mentions: [
      { start_seconds: 134, quote: "still going up", excerpt: "raw words around 134", stance: "buy", confidence: "high", time_horizon: null, is_conditional: null, condition: null },
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

beforeAll(() => {
  // jsdom doesn't implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});

describe("VideoMentions", () => {
  it("Section A shows each ticker's stance + summary, with no quotes", () => {
    wrap(<VideoMentions groups={GROUPS} onSeek={() => {}} initialTicker={null} channelId="c1" />);
    expect(screen.getByText("By stock")).toBeInTheDocument();
    expect(screen.getByText("Bullish on AAPL")).toBeInTheDocument();
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
    const aaplRow = screen.getByTestId("mention-group-AAPL");
    expect(within(aaplRow).queryByText("still going up")).toBeNull();
    expect(within(aaplRow).queryByText("watch earnings")).toBeNull();
  });

  it("Section B lists every quote ordered by ascending timestamp across tickers", () => {
    wrap(<VideoMentions groups={GROUPS} onSeek={() => {}} initialTicker={null} channelId="c1" />);
    expect(screen.getByText("Quotes (in order)")).toBeInTheDocument();
    const order = screen
      .getAllByText(/still going up|valuation too high|watch earnings/)
      .map((e) => e.textContent);
    // 134 (AAPL) -> 330 (TSLA) -> 662 (AAPL)
    expect(order).toEqual(["still going up", "valuation too high", "watch earnings"]);
    expect(screen.getByRole("button", { name: "2:14" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5:30" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "11:02" })).toBeInTheDocument();
  });

  it("calls onSeek with the mention start_seconds on timestamp click", async () => {
    const onSeek = vi.fn();
    wrap(<VideoMentions groups={GROUPS} onSeek={onSeek} initialTicker={null} channelId="c1" />);
    await userEvent.click(screen.getByRole("button", { name: "5:30" }));
    expect(onSeek).toHaveBeenCalledWith(330);
  });

  it("highlights + scrolls to the initialTicker row in Section A", () => {
    wrap(<VideoMentions groups={GROUPS} onSeek={() => {}} initialTicker="TSLA" channelId="c1" />);
    const row = screen.getByTestId("mention-group-TSLA");
    expect(row.className).toContain("ring-2");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("links tickers to their stock pages", () => {
    wrap(<VideoMentions groups={GROUPS} onSeek={() => {}} initialTicker={null} channelId="c1" />);
    const links = screen.getAllByRole("link", { name: "AAPL" });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute("href")).toContain("/stocks/AAPL");
  });

  it("links tickers to the stock page filtered by this channel", () => {
    wrap(<VideoMentions groups={GROUPS} onSeek={() => {}} initialTicker={null} channelId="c1" />);
    const links = screen.getAllByRole("link", { name: "AAPL" });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l.getAttribute("href")).toBe("/stocks/AAPL?channel=c1");
    }
  });

  it("shows the empty state when there are no groups", () => {
    wrap(<VideoMentions groups={[]} onSeek={() => {}} initialTicker={null} channelId="c1" />);
    expect(screen.getByText("No mentions")).toBeInTheDocument();
  });
});
