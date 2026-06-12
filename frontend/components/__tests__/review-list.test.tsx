import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { ReviewList } from "@/components/review-list";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = {
  Review: {
    title: "Pick videos to analyze",
    description: "Checked will be analyzed; unchecked skipped.",
    selectAll: "Select all",
    deselectAll: "Deselect all",
    confirm: "Analyze selected ({count})",
    confirming: "Submitting…",
    confirmFailed: "Failed to submit selection",
    empty: "No videos awaiting review.",
    loadError: "Failed: {message}",
  },
};

const response = {
  total: 3,
  groups: [
    {
      channel: { id: "UC_a", title: "Alpha", thumbnail_url: "" },
      videos: [
        {
          id: "v1", title: "Video 1", thumbnail_url: "",
          published_at: "2026-06-08T12:00:00Z",
          duration_seconds: 600, status: "discovered",
        },
        {
          id: "v2", title: "Video 2", thumbnail_url: "",
          published_at: "2026-06-07T12:00:00Z",
          duration_seconds: null, status: "discovered",
        },
      ],
    },
    {
      channel: { id: "UC_b", title: "Beta", thumbnail_url: "" },
      videos: [
        {
          id: "v3", title: "Video 3", thumbnail_url: "",
          published_at: "2026-06-06T12:00:00Z",
          duration_seconds: 300, status: "discovered",
        },
      ],
    },
  ],
};

function renderList(fetcher = vi.fn().mockResolvedValue(response)) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <ReviewList />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("ReviewList", () => {
  it("checks everything by default and counts selection", async () => {
    renderList();
    expect(await screen.findByText("Video 1")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Analyze selected (3)" }),
    ).toBeInTheDocument();
  });

  it("unchecking a video updates the confirm count", async () => {
    renderList();
    await screen.findByText("Video 1");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(
      screen.getByRole("button", { name: "Analyze selected (2)" }),
    ).toBeInTheDocument();
  });

  it("deselect all per channel group", async () => {
    renderList();
    await screen.findByText("Video 1");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Deselect all" })[0],
    );
    expect(
      screen.getByRole("button", { name: "Analyze selected (1)" }),
    ).toBeInTheDocument();
  });

  it("shows empty state when nothing is discovered", async () => {
    renderList(vi.fn().mockResolvedValue({ total: 0, groups: [] }));
    expect(
      await screen.findByText("No videos awaiting review."),
    ).toBeInTheDocument();
  });
});
