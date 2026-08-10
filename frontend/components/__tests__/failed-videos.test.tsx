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
    noneMatchFilter: "No videos match the current filter.",
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

// Branches the summary response on the `channel_id` query param, so a test can
// drive the real Select and observe the real fetch URL / retry body change with
// it -- rather than asserting on hand-constructed key strings that could drift
// from what the component actually builds.
function makeChannelAwareFetcher(channelSummary: Record<string, unknown>) {
  return vi.fn(async (key: string) => {
    if (key.startsWith("/api/videos/failures/items")) return itemsPage;
    if (key.startsWith("/api/videos/failures")) {
      return key.includes("channel_id=ch-a") ? channelSummary : summary;
    }
    if (key === "/api/jobs/current") return null;
    throw new Error(`unexpected key ${key}`);
  });
}

// Branches the summary response on the `max_attempts` query param, mirroring
// makeChannelAwareFetcher above but for the threshold Select, so a test can drive
// the real Select and observe the real fetch URL / retry body change with it.
function makeThresholdAwareFetcher(thresholdSummary: Record<string, unknown>) {
  return vi.fn(async (key: string) => {
    if (key.startsWith("/api/videos/failures/items")) return itemsPage;
    if (key.startsWith("/api/videos/failures")) {
      return key.includes("max_attempts=3") ? thresholdSummary : summary;
    }
    if (key === "/api/jobs/current") return null;
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
    // progress.videos_failed is also > 0 here (same as a real all-failed retry
    // would report), so this pins that the `status === "failed"` branch wins
    // over the partial-failure branch -- with an empty `progress` the amber
    // branch is trivially false regardless of branch order, and the test
    // would pass either way.
    const failedJob = {
      id: 9,
      kind: "analyze",
      status: "failed",
      progress: { videos_done: 160, videos_failed: 160, videos_total: 160 },
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

  it("says nothing about a job the user never started", async () => {
    // /api/jobs/current returns the most recent job of ANY kind once nothing is
    // running -- e.g. last night's scheduled `discover` job. Opening /failed
    // must not report on it as if it were a retry outcome.
    const staleDiscoverJob = {
      id: 4,
      kind: "discover",
      status: "failed",
      progress: {},
      started_at: "2026-08-08T00:00:00Z",
      finished_at: "2026-08-08T00:05:00Z",
      error_message: "Update failed: connection reset",
    };
    renderPage(makeFetcher(summary, staleDiscoverJob));
    await screen.findByText("Transcript unavailable");
    expect(screen.queryByText(/Update failed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Last retry/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Analysing/)).not.toBeInTheDocument();
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

  it("threads a selected channel into both the summary fetch and the retry POST body", async () => {
    // Drives the real base-ui Select (role="combobox" trigger, role="option"
    // items) rather than setting internal state directly, so this exercises the
    // exact code path a user would: click the channel filter, pick "Alpha",
    // then confirm BOTH the next summary request and the retry action pick up
    // "ch-a" -- pinning Correction 1 (only the retry-body assertion was pinned
    // before; the summary key was not).
    const channelSummary = {
      groups: [
        { kind: "transcript", total: 48, retryable: 40 },
        { kind: "analysis", total: 0, retryable: 0 },
      ],
      channels: [{ id: "ch-a", title: "Alpha", total: 48 }],
      total: 48,
    };
    const fetcher = makeChannelAwareFetcher(channelSummary);
    apiFetchMock.mockResolvedValue({ queued: 40, job_id: 11, created: true });
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByText("Transcript unavailable");

    const [channelSelect] = screen.getAllByRole("combobox");
    await user.click(channelSelect);
    await user.click(await screen.findByRole("option", { name: "Alpha (48)" }));

    // The channel-scoped summary swaps the group counts in, proving the
    // request that produced them carried channel_id=ch-a (the fetcher only
    // returns this payload for that query string).
    await screen.findByText("48 videos · 40 match the threshold");
    expect(
      fetcher.mock.calls.some(([k]) =>
        String(k).match(/^\/api\/videos\/failures\?.*channel_id=ch-a/),
      ),
    ).toBe(true);

    await user.click(
      screen.getByRole("button", { name: "Retry this group (40)" }),
    );
    expect(apiFetchMock).toHaveBeenCalledWith("/api/videos/failures/retry", {
      method: "POST",
      body: JSON.stringify({
        kind: "transcript",
        channel_id: "ch-a",
        max_attempts: null,
      }),
    });
  });

  it("threads a selected attempt threshold into both the summary fetch and the retry POST body", async () => {
    // Same shape as the channel test above, but for the threshold Select: the
    // threshold is threaded through three places (the summary key, filterFor's
    // list filter, and the retry POST body) and the channel path only got real
    // coverage after a real bug was found there (the summary key not carrying
    // channel_id) -- this pins the equivalent path for max_attempts, which had
    // no such test.
    const thresholdSummary = {
      groups: [
        { kind: "transcript", total: 160, retryable: 90 },
        { kind: "analysis", total: 53, retryable: 30 },
      ],
      channels: [{ id: "ch-a", title: "Alpha", total: 48 }],
      total: 213,
    };
    const fetcher = makeThresholdAwareFetcher(thresholdSummary);
    apiFetchMock.mockResolvedValue({ queued: 90, job_id: 12, created: true });
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByText("Transcript unavailable");

    const [, thresholdSelect] = screen.getAllByRole("combobox");
    await user.click(thresholdSelect);
    await user.click(
      await screen.findByRole("option", { name: "Fewer than 3 attempts" }),
    );

    // The threshold-scoped summary swaps the group counts in, proving the
    // request that produced them carried max_attempts=3 (the fetcher only
    // returns this payload for that query string).
    await screen.findByText("160 videos · 90 match the threshold");
    expect(
      fetcher.mock.calls.some(([k]) =>
        String(k).match(/^\/api\/videos\/failures\?.*max_attempts=3/),
      ),
    ).toBe(true);

    await user.click(
      screen.getByRole("button", { name: "Retry this group (90)" }),
    );
    expect(apiFetchMock).toHaveBeenCalledWith("/api/videos/failures/retry", {
      method: "POST",
      body: JSON.stringify({
        kind: "transcript",
        channel_id: null,
        max_attempts: 3,
      }),
    });
  });

  it("shows human labels on the Select triggers, not raw filter values", async () => {
    // SelectValue only falls back to `placeholder` when the value is empty;
    // "all" is a real value, so a missing explicit-children fix renders the
    // literal "all" / a raw channel id instead of a translated label.
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Transcript unavailable");

    expect(screen.getByText("All channels")).toBeInTheDocument();
    expect(screen.getByText("Any attempt count")).toBeInTheDocument();
    expect(screen.queryByText("all")).not.toBeInTheDocument();

    const [channelSelect] = screen.getAllByRole("combobox");
    await user.click(channelSelect);
    await user.click(await screen.findByRole("option", { name: "Alpha (48)" }));

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("ch-a")).not.toBeInTheDocument();
  });

  it("keeps the channel dropdown visible when the selected channel currently has none", async () => {
    // Correction 2's failure mode, reproduced via a channel filter rather than
    // the global empty case test 6 above already covers: the summary's `total`
    // is channel-scoped so picking a channel with zero current failures drives
    // it to 0, which must show the "doesn't match the filter" wording WITHOUT
    // tearing down the Select the user just used to get here.
    const channelSummary = { groups: [], channels: [{ id: "ch-a", title: "Alpha", total: 48 }], total: 0 };
    const fetcher = makeChannelAwareFetcher(channelSummary);
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByText("Transcript unavailable");

    const [channelSelect] = screen.getAllByRole("combobox");
    await user.click(channelSelect);
    await user.click(await screen.findByRole("option", { name: "Alpha (48)" }));

    expect(
      await screen.findByText("No videos match the current filter."),
    ).toBeInTheDocument();
    // Both selects (channel + threshold) are still mounted and usable -- the
    // user is not stranded with no way back to "All channels".
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getByText("Alpha (48)")).toBeInTheDocument();
  });
});
