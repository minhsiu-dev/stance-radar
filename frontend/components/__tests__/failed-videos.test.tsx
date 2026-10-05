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

const admin = { authenticated: true, handleAuthError: vi.fn() };
vi.mock("@/components/admin-provider", () => ({
  useAdmin: () => admin,
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

// Branches the summary response on the `channel_id` query param, so a test can
// drive the real Select and observe the real fetch URL / retry body change with
// it -- rather than asserting on hand-constructed key strings that could drift
// from what the component actually builds.
function makeChannelAwareFetcher(channelSummary: Record<string, unknown>) {
  return vi.fn(async (key: string) => {
    if (key.startsWith("/api/videos/failures/items")) return items;
    if (key.startsWith("/api/videos/failures")) {
      return key.includes("channel_id=ch-a") ? channelSummary : summary;
    }
    throw new Error(`unexpected key ${key}`);
  });
}

// Branches the summary response on the `max_attempts` query param, mirroring
// makeChannelAwareFetcher above but for the threshold Select, so a test can drive
// the real Select and observe the real fetch URL / retry body change with it.
function makeThresholdAwareFetcher(thresholdSummary: Record<string, unknown>) {
  return vi.fn(async (key: string) => {
    if (key.startsWith("/api/videos/failures/items")) return items;
    if (key.startsWith("/api/videos/failures")) {
      return key.includes("max_attempts=3") ? thresholdSummary : summary;
    }
    throw new Error(`unexpected key ${key}`);
  });
}

function renderFailed(
  kind: "transcript" | "analysis",
  fetcher: ReturnType<typeof makeChannelAwareFetcher> | ((key: string) => Promise<unknown>) = (key: string) =>
    Promise.resolve(key.startsWith("/api/videos/failures/items") ? items : summary),
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map(), dedupingInterval: 0 }}>
        <FailedVideos kind={kind} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return fetcher;
}

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({ queued: 1 });
  admin.authenticated = true;
  admin.handleAuthError.mockReset();
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
    renderFailed("analysis", (key: string) =>
      Promise.resolve(
        key.startsWith("/api/videos/failures/items")
          ? items
          : {
              ...summary,
              groups: [
                { kind: "transcript", total: 160, retryable: 112 },
                { kind: "analysis", total: 0, retryable: 0 },
              ],
            },
      ),
    );
    expect(await screen.findByText("No failed videos.")).toBeInTheDocument();
  });

  it("reports a failed retry", async () => {
    apiFetchMock.mockRejectedValue(new Error("boom"));
    renderFailed("analysis");
    await userEvent.click(await screen.findByRole("button", { name: "Retry this group (53)" }));
    expect(await screen.findByText("Retry failed: boom")).toBeInTheDocument();
    await waitFor(() => expect(admin.handleAuthError).toHaveBeenCalled());
  });

  it("threads a selected channel into both the summary fetch and the retry POST body", async () => {
    // Drives the real base-ui Select to verify that when a channel is selected,
    // the channel_id is threaded through both the summary fetch key and retry POST body.
    const channelSummary = {
      groups: [{ kind: "transcript", total: 48, retryable: 40 }],
      channels: [{ id: "ch-a", title: "Alpha", total: 48 }],
      total: 48,
    };
    const fetcher = makeChannelAwareFetcher(channelSummary);
    apiFetchMock.mockResolvedValue({ queued: 40 });
    const user = userEvent.setup();
    renderFailed("transcript", fetcher);
    await screen.findByText(/YouTube blocked the transcript request/);

    // Open the channel select and click Alpha option
    // Option name is formatted as "{title} ({count})" from the base summary's channels
    const [channelSelect] = screen.getAllByRole("combobox");
    await user.click(channelSelect);
    const alphaOption = await screen.findByRole("option", { name: /^Alpha/ });
    await user.click(alphaOption);

    // The channel-scoped summary swaps the group counts in, proving the
    // request that produced them carried channel_id=ch-a (the fetcher only
    // returns this payload for that query string).
    await screen.findByText("48 videos · 40 match the threshold");
    expect(
      fetcher.mock.calls.some(([k]) =>
        String(k).match(/^\/api\/videos\/failures\?.*channel_id=ch-a/),
      ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Retry this group (40)" }));
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
    // threshold is threaded through multiple places (the summary key, the retry
    // POST body, and the list filter).
    const thresholdSummary = {
      groups: [{ kind: "transcript", total: 160, retryable: 90 }],
      channels: [{ id: "ch-a", title: "Alpha", total: 48 }],
      total: 160,
    };
    const fetcher = makeThresholdAwareFetcher(thresholdSummary);
    apiFetchMock.mockResolvedValue({ queued: 90 });
    const user = userEvent.setup();
    renderFailed("transcript", fetcher);
    await screen.findByText(/YouTube blocked the transcript request/);

    const [, thresholdSelect] = screen.getAllByRole("combobox");
    await user.click(thresholdSelect);
    await user.click(await screen.findByRole("option", { name: "Fewer than 3 attempts" }));

    // The threshold-scoped summary swaps the group counts in, proving the
    // request that produced them carried max_attempts=3 (the fetcher only
    // returns this payload for that query string).
    await screen.findByText("160 videos · 90 match the threshold");
    expect(
      fetcher.mock.calls.some(([k]) =>
        String(k).match(/^\/api\/videos\/failures\?.*max_attempts=3/),
      ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Retry this group (90)" }));
    expect(apiFetchMock).toHaveBeenCalledWith("/api/videos/failures/retry", {
      method: "POST",
      body: JSON.stringify({
        kind: "transcript",
        channel_id: null,
        max_attempts: 3,
      }),
    });
  });

  it("keeps the channel dropdown visible when the selected channel currently has none", async () => {
    // The `keepPreviousData` guard ensures that when the selected channel has
    // zero current failures, the selects stay mounted with "No videos match"
    // wording, not the global "No failed videos." text, and the user isn't
    // stranded with no way to pick a different channel.
    const channelSummary = {
      groups: [],
      channels: [{ id: "ch-a", title: "Alpha", total: 48 }],
      total: 0,
    };
    const fetcher = makeChannelAwareFetcher(channelSummary);
    const user = userEvent.setup();
    renderFailed("transcript", fetcher);
    await screen.findByText(/YouTube blocked the transcript request/);

    // Select Alpha channel
    const [channelSelect] = screen.getAllByRole("combobox");
    await user.click(channelSelect);
    const alphaOption = await screen.findByRole("option", { name: /^Alpha/ });
    await user.click(alphaOption);

    // When the channel has zero failures, should show "No videos match..."
    // not the global "No failed videos."
    expect(await screen.findByText("No videos match the current filter.")).toBeInTheDocument();
    expect(screen.queryByText("No failed videos.")).not.toBeInTheDocument();

    // Both selects are still mounted and usable -- the user is not stranded
    // with no way back to "All channels".
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("hides retry controls when not authenticated", async () => {
    admin.authenticated = false;
    renderFailed("transcript");
    await screen.findByText(/YouTube blocked the transcript request/);
    expect(screen.queryByRole("button", { name: /Retry this group/ })).not.toBeInTheDocument();
  });
});
