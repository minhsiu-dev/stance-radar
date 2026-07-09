import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { ReviewList } from "@/components/review-list";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
});

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
  it("starts with nothing selected (opt-in) so the count is zero", async () => {
    renderList();
    expect(await screen.findByText("Video 1")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Analyze selected (0)" }),
    ).toBeInTheDocument();
  });

  it("checking a video updates the confirm count", async () => {
    renderList();
    await screen.findByText("Video 1");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(
      screen.getByRole("button", { name: "Analyze selected (1)" }),
    ).toBeInTheDocument();
  });

  it("select all per channel group", async () => {
    renderList();
    await screen.findByText("Video 1");
    // The first channel group (Alpha) has 2 videos
    fireEvent.click(screen.getAllByRole("button", { name: "Select all" })[0]);
    expect(
      screen.getByRole("button", { name: "Analyze selected (2)" }),
    ).toBeInTheDocument();
  });

  it("confirming with nothing selected skips all discovered videos and analyzes none", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderList();
    await screen.findByText("Video 1");

    fireEvent.click(screen.getByRole("button", { name: "Analyze selected (0)" }));

    await waitFor(() => {
      const skipCall = fetchMock.mock.calls.find(([url]) => url === "/api/videos/skip");
      expect(skipCall).toBeTruthy();
      expect(JSON.parse((skipCall![1] as RequestInit).body as string).video_ids.sort()).toEqual(
        ["v1", "v2", "v3"],
      );
    });
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/videos/analyze"),
    ).toBe(false);
    vi.unstubAllGlobals();
  });

  it("shows empty state when nothing is discovered", async () => {
    renderList(vi.fn().mockResolvedValue({ total: 0, groups: [] }));
    expect(
      await screen.findByText("No videos awaiting review."),
    ).toBeInTheDocument();
  });

  it("hides selection and confirm controls when not authenticated, keeping the video list visible", async () => {
    useAdmin.mockReturnValue({ authenticated: false, handleAuthError: vi.fn() });
    renderList();
    // Read-only content stays visible
    expect(await screen.findByText("Video 1")).toBeInTheDocument();
    expect(screen.getByText("Video 3")).toBeInTheDocument();
    // Write affordances are gone
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Select all" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Analyze selected/ })).not.toBeInTheDocument();
  });

  it("routes a 401 during confirm back through handleAuthError", async () => {
    const handleAuthError = vi.fn();
    useAdmin.mockReturnValue({ authenticated: true, handleAuthError });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ success: false, error: "Unauthorized" }),
      }),
    );
    renderList();
    await screen.findByText("Video 1");

    fireEvent.click(screen.getByRole("button", { name: "Analyze selected (0)" }));

    await waitFor(() => {
      expect(handleAuthError).toHaveBeenCalledTimes(1);
    });
    const [err] = handleAuthError.mock.calls[0];
    expect(err).toMatchObject({ status: 401 });
    vi.unstubAllGlobals();
  });
});
