import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { FailedVideos } from "@/components/failed-videos";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const messages = {
  Failed: {
    empty: "No failed videos.",
    loadError: "Failed to load: {message}",
    allChannels: "All channels",
    channelOption: "{title} ({count})",
    thresholdAll: "Any attempt count",
    thresholdUnder: "Fewer than {n} attempts",
    counts: "{total} videos · {retryable} match the threshold",
    retryGroup: "Retry this group ({count})",
    retryOne: "Retry",
    expand: "Show list",
    collapse: "Hide list",
    loadMore: "Load more",
    attempts: "{count} attempts · last {date}",
    attemptsNever: "{count} attempts · not retried yet",
    retryFailed: "Retry failed: {message}",
    kinds: {
      transcript: { title: "Transcript unavailable", description: "blocked" },
      analysis: { title: "Analysis crashed", description: "offline" },
    },
    job: {
      running: "Analysing {done} / {total}",
      partial: "Last retry: {failed} of {total} failed again",
      failed: "Last retry failed entirely: {message}",
      queued: "Queued into the job already running",
    },
  },
};

const summary = {
  groups: [
    { kind: "transcript", total: 160, retryable: 143 },
    { kind: "analysis", total: 53, retryable: 53 },
  ],
  channels: [{ id: "ch-a", title: "Alpha", total: 48 }],
  total: 213,
};

const emptySummary = { groups: [], channels: [], total: 0 };

const itemsPage = {
  items: [
    {
      id: "v1",
      title: "Title v1",
      thumbnail_url: "",
      channel: { id: "ch-a", title: "Alpha" },
      published_at: "2026-06-01T00:00:00Z",
      duration_seconds: 600,
      error_message: "claude exited -11",
      analysis_attempts: 2,
      last_attempt_at: null,
    },
  ],
  total: 1,
  page: 1,
  page_size: 20,
};

function makeFetcher(sum: unknown = summary, job: unknown = null) {
  return vi.fn(async (key: string) => {
    if (key.startsWith("/api/videos/failures/items")) return itemsPage;
    if (key.startsWith("/api/videos/failures")) return sum;
    if (key === "/api/jobs/current") return job;
    throw new Error(`unexpected key ${key}`);
  });
}

function renderPage(fetcher = makeFetcher()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <FailedVideos />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return fetcher;
}

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
  apiFetchMock.mockReset();
});

describe("FailedVideos", () => {
  it("renders one card per kind with totals and threshold counts", async () => {
    renderPage();
    expect(await screen.findByText("Transcript unavailable")).toBeInTheDocument();
    expect(screen.getByText("Analysis crashed")).toBeInTheDocument();
    expect(
      screen.getByText("160 videos · 143 match the threshold"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry this group (143)" }),
    ).toBeInTheDocument();
  });

  it("fetches no rows until a card is expanded", async () => {
    const fetcher = renderPage();
    await screen.findByText("Transcript unavailable");
    expect(
      fetcher.mock.calls.filter(([k]) =>
        String(k).startsWith("/api/videos/failures/items"),
      ),
    ).toHaveLength(0);

    await userEvent.click(screen.getAllByRole("button", { name: "Show list" })[0]);
    expect(await screen.findByText("Title v1")).toBeInTheDocument();
  });

  it("posts the group retry with the current filters", async () => {
    apiFetchMock.mockResolvedValue({ queued: 143, job_id: 7, created: true });
    renderPage();
    await screen.findByText("Transcript unavailable");

    await userEvent.click(
      screen.getByRole("button", { name: "Retry this group (143)" }),
    );

    expect(apiFetchMock).toHaveBeenCalledWith("/api/videos/failures/retry", {
      method: "POST",
      body: JSON.stringify({
        kind: "transcript",
        channel_id: null,
        max_attempts: null,
      }),
    });
  });

  it("surfaces a wholly-failed retry job instead of looking like nothing happened", async () => {
    const failedJob = {
      id: 9,
      kind: "analyze",
      status: "failed",
      progress: {},
      started_at: "2026-08-09T00:00:00Z",
      finished_at: "2026-08-09T00:05:00Z",
      error_message: "All 160 videos failed; last error: IpBlocked",
    };
    renderPage(makeFetcher(summary, failedJob));
    expect(
      await screen.findByText(
        "Last retry failed entirely: All 160 videos failed; last error: IpBlocked",
      ),
    ).toBeInTheDocument();
  });

  it("hides retry controls when not authenticated", async () => {
    useAdmin.mockReturnValue({ authenticated: false, handleAuthError: vi.fn() });
    renderPage();
    await screen.findByText("Transcript unavailable");
    expect(
      screen.queryByRole("button", { name: /Retry this group/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing has failed", async () => {
    renderPage(makeFetcher(emptySummary));
    expect(await screen.findByText("No failed videos.")).toBeInTheDocument();
  });
});
