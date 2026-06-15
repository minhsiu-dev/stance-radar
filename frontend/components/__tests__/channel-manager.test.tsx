import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { ChannelManager } from "@/components/channel-manager";
import type { ChannelOverviewItem, ChannelOverviewResponse } from "@/lib/types";

const messages = {
  Channels: {
    list: {
      empty: "No channels",
      lastUpdated: "Updated {date}",
      neverUpdated: "Never",
      remove: "Remove",
      removeFailed: "Delete failed",
      removePrompt: "Remove {name}?",
      pendingBadge: "{count} review",
      autoBadge: "Auto",
      analyzedCount: "{count} analyzed",
    },
    activity: { legend: "published / analyzed", tooltip: "{total} pub · {analyzed} an" },
    pager: { prev: "Previous", next: "Next", page: "Page {page} / {pages}" },
  },
};

function item(id: string): ChannelOverviewItem {
  return {
    id,
    title: `Channel ${id}`,
    thumbnail_url: "",
    auto_analyze: false,
    added_at: "2026-06-01T00:00:00Z",
    last_refreshed_at: null,
    video_counts: { analyzed: 3 },
    weekly_activity: [
      { week_start: "2026-05-18", total: 1, analyzed: 1 },
      { week_start: "2026-05-25", total: 0, analyzed: 0 },
      { week_start: "2026-06-01", total: 2, analyzed: 1 },
      { week_start: "2026-06-08", total: 0, analyzed: 0 },
      { week_start: "2026-06-15", total: 1, analyzed: 0 },
    ],
  };
}

function page(n: number): ChannelOverviewResponse {
  return { items: [item(`c${n}`)], total: 15, page: n, page_size: 10 };
}

function wrap() {
  const fetcher = vi.fn((key: string) => {
    const p = new URL(key, "http://x").searchParams.get("page") ?? "1";
    return Promise.resolve(page(Number(p)));
  });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <ChannelManager />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return fetcher;
}

describe("ChannelManager", () => {
  it("renders rows with activity bars and a working pager", async () => {
    wrap();
    expect(await screen.findByText("Channel c1")).toBeInTheDocument();
    expect(screen.getAllByTestId("bar-total").length).toBe(5);
    expect(screen.getByText("Page 1 / 2")).toBeInTheDocument();
    const prev = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();

    fireEvent.click(next);
    expect(await screen.findByText("Channel c2")).toBeInTheDocument();
    expect(screen.getByText("Page 2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
