import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { FailedVideos } from "@/components/failed-videos";
import type { FailedVideosResponse, FailuresSummary } from "@/lib/types";
import { messages } from "./pipeline-fixtures";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const handleAuthError = vi.fn();
vi.mock("@/components/admin-provider", () => ({
  useAdmin: () => ({ authenticated: true, handleAuthError }),
}));

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const summary: FailuresSummary = {
  groups: [
    { kind: "transcript", total: 160, retryable: 112 },
    { kind: "analysis", total: 53, retryable: 53 },
  ],
  channels: [{ id: "ch-a", title: "Alpha", total: 213 }],
  total: 213,
};

const items: FailedVideosResponse = {
  items: [
    {
      id: "f1",
      title: "Blocked video",
      thumbnail_url: "",
      channel: { id: "ch-a", title: "Alpha" },
      published_at: "2026-09-01T00:00:00Z",
      duration_seconds: 600,
      error_message: "RequestBlocked",
      attempts: 4,
      last_attempt_at: "2026-10-02T00:00:00Z",
    },
  ],
  total: 1,
  page: 1,
  page_size: 20,
};

function renderFailed(kind: "transcript" | "analysis", data: FailuresSummary = summary) {
  const fetcher = (key: string) =>
    Promise.resolve(key.startsWith("/api/videos/failures/items") ? items : data);
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map(), dedupingInterval: 0 }}>
        <FailedVideos kind={kind} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({ queued: 1 });
  handleAuthError.mockReset();
});

describe("FailedVideos", () => {
  it("shows only its own kind", async () => {
    renderFailed("transcript");
    expect(await screen.findByRole("button", { name: "Retry this group (112)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry this group (53)" })).toBeNull();
    expect(await screen.findByText("Blocked video")).toBeInTheDocument();
  });

  it("retries the whole group for its kind", async () => {
    renderFailed("transcript");
    await userEvent.click(await screen.findByRole("button", { name: "Retry this group (112)" }));
    expect(apiFetchMock).toHaveBeenCalledWith("/api/videos/failures/retry", {
      method: "POST",
      body: JSON.stringify({ kind: "transcript", channel_id: null, max_attempts: null }),
    });
  });

  it("retries one video through the analyze endpoint", async () => {
    renderFailed("transcript");
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(apiFetchMock).toHaveBeenCalledWith("/api/videos/analyze", {
      method: "POST",
      body: JSON.stringify({ video_ids: ["f1"] }),
    });
  });

  it("shows the empty state when its kind has nothing", async () => {
    renderFailed("analysis", {
      ...summary,
      groups: [
        { kind: "transcript", total: 160, retryable: 112 },
        { kind: "analysis", total: 0, retryable: 0 },
      ],
    });
    expect(await screen.findByText("No failed videos.")).toBeInTheDocument();
  });

  it("reports a failed retry", async () => {
    apiFetchMock.mockRejectedValue(new Error("boom"));
    renderFailed("analysis");
    await userEvent.click(await screen.findByRole("button", { name: "Retry this group (53)" }));
    expect(await screen.findByText("Retry failed: boom")).toBeInTheDocument();
    await waitFor(() => expect(handleAuthError).toHaveBeenCalled());
  });
});
