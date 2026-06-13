import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { MentionsTable } from "@/components/mentions-table";

const messages = {
  Mentions: {
    title: "Mentions",
    empty: "no mentions",
    loadError: "Error: {message}",
    filter: { stance: "Stance", allStances: "All", channel: "Channel", allChannels: "All channels" },
    columns: { date: "Date", channel: "Channel", timestamp: "T", quote: "Quote", stance: "St", open: "Open" },
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
  mentions: [
    {
      start_seconds: 42,
      quote: "I'm bullish on Google",
      context_before: "Let's talk about big tech.",
      context_after: "That's my take for now.",
      youtube_url: "https://www.youtube.com/watch?v=v1&t=42s",
    },
    {
      start_seconds: 125,
      quote: "Still adding to my Google position",
      context_before: null,
      context_after: null,
      youtube_url: "https://www.youtube.com/watch?v=v1&t=125s",
    },
  ],
};

function setup(data = [ROW]) {
  const fetcher = vi.fn().mockResolvedValue(data);
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <MentionsTable ticker="GOOGL" selectedVideoId={null} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("MentionsTable", () => {
  it("renders channel avatar only, not channel name text", async () => {
    setup();
    await screen.findByText(/I'm bullish on Google/);
    expect(screen.queryByText("Joseph Carlson")).toBeNull();
    const avatar = screen.getByAltText("Joseph Carlson");
    expect(avatar.tagName).toBe("IMG");
    expect(avatar.getAttribute("src")).toBe("https://example.com/avatar.jpg");
    expect(avatar.getAttribute("title")).toBe("Joseph Carlson");
  });

  it("no longer renders standalone mention-timestamp deep links", async () => {
    setup();
    await screen.findByText(/I'm bullish on Google/);
    expect(screen.queryByRole("link", { name: "0:42" })).toBeNull();
    expect(screen.queryByRole("link", { name: "2:05" })).toBeNull();
  });

  it("links the channel avatar to the channel page", async () => {
    setup();
    await screen.findByText(/I'm bullish on Google/);
    const link = screen.getByRole("link", { name: "Joseph Carlson" });
    expect(link.getAttribute("href")).toContain("/channels/ch_abc");
  });

  it("shows +N indicator when a video has multiple mentions", async () => {
    setup();
    await screen.findByText(/I'm bullish on Google/);
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("does not render video title column", async () => {
    setup();
    await screen.findByText(/I'm bullish on Google/);
    expect(screen.queryByText("Some video")).toBeNull();
  });

  it("does not render summary text in the table", async () => {
    setup();
    await screen.findByText(/I'm bullish on Google/);
    expect(screen.queryByText("Overall bullish on Google")).toBeNull();
  });

  it("row click does NOT navigate", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null as never);
    setup();
    const row = (await screen.findByText(/I'm bullish on Google/)).closest("tr")!;
    fireEvent.click(row);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("ArrowUpRight link goes to the internal video page", async () => {
    setup();
    await screen.findByText(/I'm bullish on Google/);
    const link = screen.getByRole("link", { name: /Open/i });
    expect(link.getAttribute("href")).toContain("/videos/v1");
    expect(link.getAttribute("href")).toContain("ticker=GOOGL");
    expect(link.getAttribute("href")).not.toContain("youtube.com");
  });

  it("invokes onRowHover with video_id on mouseEnter / null on leave", async () => {
    const onRowHover = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ fetcher: vi.fn().mockResolvedValue([ROW]), provider: () => new Map() }}>
          <MentionsTable ticker="GOOGL" selectedVideoId={null} onRowHover={onRowHover} />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    const row = (await screen.findByText(/I'm bullish on Google/)).closest("tr")!;
    fireEvent.mouseEnter(row);
    expect(onRowHover).toHaveBeenLastCalledWith("v1");
    fireEvent.mouseLeave(row);
    expect(onRowHover).toHaveBeenLastCalledWith(null);
  });
});
