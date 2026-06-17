import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { MentionsByStock } from "@/components/mentions-by-stock";
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
  Element.prototype.scrollIntoView = vi.fn();
});

describe("MentionsByStock", () => {
  it("shows each ticker's stance + summary, with no quotes", () => {
    wrap(<MentionsByStock groups={GROUPS} initialTicker={null} channelId="c1" />);
    expect(screen.getByText("Bullish on AAPL")).toBeInTheDocument();
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
    const aaplRow = screen.getByTestId("mention-group-AAPL");
    expect(within(aaplRow).queryByText("still going up")).toBeNull();
  });

  it("highlights + scrolls to the initialTicker row", () => {
    wrap(<MentionsByStock groups={GROUPS} initialTicker="TSLA" channelId="c1" />);
    const row = screen.getByTestId("mention-group-TSLA");
    expect(row.className).toContain("ring-2");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("links tickers to the stock page filtered by this channel", () => {
    wrap(<MentionsByStock groups={GROUPS} initialTicker={null} channelId="c1" />);
    const links = screen.getAllByRole("link", { name: "AAPL" });
    expect(links[0].getAttribute("href")).toBe("/stocks/AAPL?channel=c1");
  });

  it("shows the empty state when there are no groups", () => {
    wrap(<MentionsByStock groups={[]} initialTicker={null} channelId="c1" />);
    expect(screen.getByText("No mentions")).toBeInTheDocument();
  });
});
