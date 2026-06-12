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
  published_at: "2026-06-10T00:00:00Z",
  start_seconds: 42,
  quote: "I'm bullish on Google",
  stance: "buy",
  reasoning: "deep moat",
  context_before: "Let's talk about big tech.",
  context_after: "That's my take for now.",
  youtube_url: "https://youtu.be/v1?t=42s",
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
  it("does not render video title column", async () => {
    setup();
    await screen.findByText("I'm bullish on Google");
    expect(screen.queryByText("Some video")).toBeNull();
  });

  it("does not render reasoning column", async () => {
    setup();
    await screen.findByText("I'm bullish on Google");
    expect(screen.queryByText("deep moat")).toBeNull();
  });

  it("row click does NOT navigate", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null as never);
    setup();
    const row = (await screen.findByText("I'm bullish on Google")).closest("tr")!;
    fireEvent.click(row);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("ArrowUpRight link opens YouTube in new tab", async () => {
    setup();
    await screen.findByText("I'm bullish on Google");
    const link = screen.getByRole("link", { name: /Open/i });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("href")).toContain("youtu.be/v1");
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
    const row = (await screen.findByText("I'm bullish on Google")).closest("tr")!;
    fireEvent.mouseEnter(row);
    expect(onRowHover).toHaveBeenLastCalledWith("v1");
    fireEvent.mouseLeave(row);
    expect(onRowHover).toHaveBeenLastCalledWith(null);
  });
});
