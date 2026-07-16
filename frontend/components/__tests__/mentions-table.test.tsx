import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { MentionsTable } from "@/components/mentions-table";

const messages = {
  Mentions: {
    title: "Mentions",
    empty: "no mentions",
    loadError: "Error: {message}",
    quoteInfo: "Show quotes",
    filter: { stance: "Stance", allStances: "All", channel: "Channel", allChannels: "All channels" },
    columns: { date: "Date", channel: "Channel", price: "Price then", stance: "St" },
  },
  Stock: { stance: { buy: "Buy", neutral: "Neutral", sell: "Sell" } },
};

const ROW = {
  video_id: "v1",
  video_title: "Some video",
  channel_id: "ch_abc",
  channel_title: "Joseph Carlson",
  channel_thumbnail: "https://example.com/avatar.jpg",
  published_at: "2026-06-10T00:00:00Z",
  stance: "buy",
  summary: "Overall bullish on Google",
  youtube_url: "https://www.youtube.com/watch?v=v1",
  entry_price: 150.0,
  entry_date: "2026-06-11",
  mentions: [
    {
      start_seconds: 42,
      quote: "I'm bullish on Google",
      context_before: "Let's talk about big tech.",
      context_after: "That's my take for now.",
      excerpt: null,
      youtube_url: "https://www.youtube.com/watch?v=v1&t=42s",
    },
    {
      start_seconds: 125,
      quote: "Still adding to my Google position",
      context_before: null,
      context_after: null,
      excerpt: "raw transcript words around the mention",
      youtube_url: "https://www.youtube.com/watch?v=v1&t=125s",
    },
  ],
};

const SUMMARY = { ticker: "GOOGL", name: "Alphabet Inc.", price: 165.0 };

function setup(
  data = [ROW],
  overrides: Record<string, unknown> = {},
  summary: unknown = SUMMARY,
) {
  const fetcher = vi.fn((url: string) =>
    Promise.resolve(url.endsWith("/mentions") ? data : summary),
  );
  const props = {
    stanceFilter: "all" as const,
    channelFilter: "all",
    onStanceFilterChange: vi.fn(),
    onChannelFilterChange: vi.fn(),
    ...overrides,
  };
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <MentionsTable ticker="GOOGL" selectedVideoId={null} {...props} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("MentionsTable", () => {
  it("renders channel avatar only, not channel name text", async () => {
    setup();
    await screen.findByText("$150.00");
    expect(screen.queryByText("Joseph Carlson")).toBeNull();
    const avatar = screen.getByAltText("Joseph Carlson");
    expect(avatar.tagName).toBe("IMG");
    expect(avatar.getAttribute("src")).toBe("https://example.com/avatar.jpg");
    expect(avatar.getAttribute("title")).toBe("Joseph Carlson");
  });

  it("no longer renders standalone mention-timestamp deep links", async () => {
    setup();
    await screen.findByText("$150.00");
    expect(screen.queryByRole("link", { name: "0:42" })).toBeNull();
    expect(screen.queryByRole("link", { name: "2:05" })).toBeNull();
  });

  it("links the channel avatar to the channel page", async () => {
    setup();
    await screen.findByText("$150.00");
    const link = screen.getByRole("link", { name: "Joseph Carlson" });
    expect(link.getAttribute("href")).toContain("/channels/ch_abc");
  });

  it("does not render quote text directly in the table", async () => {
    setup();
    await screen.findByText("$150.00");
    expect(screen.queryByText(/I'm bullish on Google/)).toBeNull();
    expect(screen.queryByText(/Still adding to my Google position/)).toBeNull();
  });

  it("renders an info trigger with the mention count when a video has multiple mentions", async () => {
    setup();
    await screen.findByText("$150.00");
    const trigger = screen.getByRole("button", { name: "Show quotes" });
    expect(within(trigger).getByText("2")).toBeInTheDocument();
  });

  it("omits the count when a video has a single mention", async () => {
    setup([{ ...ROW, mentions: [ROW.mentions[0]] }]);
    await screen.findByText("$150.00");
    const trigger = screen.getByRole("button", { name: "Show quotes" });
    expect(within(trigger).queryByText("1")).toBeNull();
  });

  it("shows entry price with gain percent vs current price, colored and dated", async () => {
    setup();
    const pct = await screen.findByText("+10.00%"); // (165 / 150 - 1) * 100
    expect(pct.className).toContain("text-emerald-600");
    expect(pct.closest("td")!.getAttribute("title")).toBe("2026-06-11");
  });

  it("colors a loss in rose", async () => {
    setup([ROW], {}, { ...SUMMARY, price: 120.0 });
    const pct = await screen.findByText("-20.00%");
    expect(pct.className).toContain("text-rose-600");
  });

  it("renders an em dash when entry_price is null", async () => {
    setup([{ ...ROW, entry_price: null, entry_date: null }]);
    expect(await screen.findByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("shows the entry price without a percent when the current price is unavailable", async () => {
    setup([ROW], {}, { ...SUMMARY, price: null });
    expect(await screen.findByText("$150.00")).toBeInTheDocument();
    expect(screen.queryByText("+10.00%")).toBeNull();
  });

  it("does not render video title column", async () => {
    setup();
    await screen.findByText("$150.00");
    expect(screen.queryByText("Some video")).toBeNull();
  });

  it("does not render summary text in the table", async () => {
    setup();
    await screen.findByText("$150.00");
    expect(screen.queryByText("Overall bullish on Google")).toBeNull();
  });

  it("row click does NOT navigate", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null as never);
    setup();
    const row = (await screen.findByText("$150.00")).closest("tr")!;
    fireEvent.click(row);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("stance badge links to the internal video page", async () => {
    setup();
    await screen.findByText("$150.00");
    const link = screen.getByRole("link", { name: /Buy/i });
    expect(link.getAttribute("href")).toContain("/videos/v1");
    expect(link.getAttribute("href")).toContain("ticker=GOOGL");
    expect(link.getAttribute("href")).not.toContain("youtube.com");
  });

  it("invokes onRowHover with video_id on mouseEnter / null on leave", async () => {
    const onRowHover = vi.fn();
    setup([ROW], { onRowHover });
    const row = (await screen.findByText("$150.00")).closest("tr")!;
    fireEvent.mouseEnter(row);
    expect(onRowHover).toHaveBeenLastCalledWith("v1");
    fireEvent.mouseLeave(row);
    expect(onRowHover).toHaveBeenLastCalledWith(null);
  });

  it("applies the controlled stanceFilter to the rows shown", async () => {
    const SELL_ROW = {
      ...ROW,
      video_id: "v2",
      stance: "sell",
      entry_price: 200.0,
      mentions: [{ ...ROW.mentions[0], quote: "Time to sell" }],
    };
    setup([ROW, SELL_ROW], { stanceFilter: "sell" });
    expect(await screen.findByText("$200.00")).toBeInTheDocument();
    expect(screen.queryByText("$150.00")).toBeNull();
  });
});
