import { render, screen } from "@testing-library/react";
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
    mentionsHeading: "Mentions & stances",
    mentionCount: "{count} mentions",
    jumpHint: "Click a timestamp to jump there",
    noMentions: "No mentions",
    viewStock: "Stock page",
  },
};

const GROUPS: VideoDetailGroup[] = [
  {
    ticker: "AAPL",
    stance: "buy",
    summary: "Bullish on AAPL",
    confidence: "high",
    mentions: [
      { start_seconds: 134, quote: "still going up", excerpt: "raw words around 134", stance: "buy", confidence: "high", time_horizon: null, is_conditional: null, condition: null },
      { start_seconds: 662, quote: "watch earnings", excerpt: null, stance: "neutral", confidence: null, time_horizon: null, is_conditional: null, condition: null },
    ],
  },
  {
    ticker: "TSLA",
    stance: "sell",
    summary: "Too expensive",
    confidence: "medium",
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
  it("renders one group per ticker with formatted timestamps and quotes", () => {
    wrap(<VideoMentions groups={GROUPS} onSeek={() => {}} initialTicker={null} />);
    expect(screen.getByText("Bullish on AAPL")).toBeInTheDocument();
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
    expect(screen.getByText("still going up")).toBeInTheDocument();
    // 134s → "2:14", 662s → "11:02", 330s → "5:30"
    expect(screen.getByRole("button", { name: "2:14" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "11:02" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5:30" })).toBeInTheDocument();
  });

  it("calls onSeek with the mention's start_seconds when a timestamp is clicked", async () => {
    const onSeek = vi.fn();
    wrap(<VideoMentions groups={GROUPS} onSeek={onSeek} initialTicker={null} />);
    await userEvent.click(screen.getByRole("button", { name: "5:30" }));
    expect(onSeek).toHaveBeenCalledWith(330);
  });

  it("highlights and scrolls to the initialTicker group", () => {
    wrap(<VideoMentions groups={GROUPS} onSeek={() => {}} initialTicker="TSLA" />);
    const group = screen.getByTestId("mention-group-TSLA");
    expect(group.className).toContain("ring-2");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("shows empty state when there are no groups", () => {
    wrap(<VideoMentions groups={[]} onSeek={() => {}} initialTicker={null} />);
    expect(screen.getByText("No mentions")).toBeInTheDocument();
  });

  it("links the ticker (left) to its stock page", async () => {
    wrap(<VideoMentions groups={GROUPS} onSeek={() => {}} initialTicker={null} />);
    const link = screen.getByRole("link", { name: "AAPL" });
    expect(link.getAttribute("href")).toContain("/stocks/AAPL");
  });

  it("has no separate right-side stock-page link and no header stance bubble", async () => {
    wrap(<VideoMentions groups={GROUPS} onSeek={() => {}} initialTicker={null} />);
    expect(screen.queryByText("Stock page")).toBeNull(); // viewStock link gone
    // header no longer renders "AAPL · Buy" badge; ticker link is plain "AAPL"
    expect(screen.queryByText("AAPL · Buy")).toBeNull();
  });

  it("is expanded by default (mention quotes visible without clicking)", async () => {
    wrap(<VideoMentions groups={GROUPS} onSeek={() => {}} initialTicker={null} />);
    expect(screen.getByText("still going up")).toBeInTheDocument();
  });
});
