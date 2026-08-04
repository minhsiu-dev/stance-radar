import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { RefreshButton } from "@/components/refresh-button";

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// RefreshButton passes `apiFetch` itself as the SWR fetcher, which overrides
// SWRConfig's global `fetcher` default — so mocking apiFetch directly (rather
// than relying on SWRConfig's fetcher option) is what actually reaches the
// component's useSWR call.
const apiFetchMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const messages = {
  Dashboard: {
    refresh: {
      label: "Check new videos",
      running: "Working… {stage}",
      lastFailed: "Last update failed: {message}",
      lastPartialFailure:
        "{failed, plural, one {# video} other {# videos}} failed to analyze in the last update",
      triggerFailed: "Update failed",
      autoEvery: "Auto-refresh every {minutes} min",
      stages: {
        listing: "Checking channels {done}/{total}",
        analyzing: "Analyzing videos {done}/{total}",
        preparing: "Preparing…",
      },
      noNew: "No new videos found",
    },
  },
};

function wrap(videosFailed: number) {
  const job = {
    id: 1,
    kind: "analyze",
    status: "done",
    progress: {
      stage: "analyzing",
      videos_done: 3,
      videos_failed: videosFailed,
      videos_total: 3,
    },
    started_at: "2026-08-03T00:00:00Z",
    finished_at: "2026-08-03T00:01:00Z",
    error_message: null,
  };
  apiFetchMock.mockResolvedValue(job);
  // Expose the SWR cache Map so tests can prove the fetch actually settled
  // (a same-shaped `job` with videos_failed: 0 renders identically to "no
  // job loaded yet" — see test 2 below — so the DOM alone can't prove data
  // arrived; SWR's own cache entry for the key can).
  const cache = new Map();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ provider: () => cache }}>
        <RefreshButton />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return cache;
}

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
});

it("reports how many videos failed in a finished run", async () => {
  wrap(1);
  expect(
    await screen.findByText("1 video failed to analyze in the last update"),
  ).toBeInTheDocument();
});

it("stays quiet when the finished run had no failures", async () => {
  const cache = wrap(0);
  // A job with videos_failed: 0 renders identically to no job having loaded
  // yet (button just says "Check new videos" either way), so proving the
  // absence of the failure message is meaningful requires first proving the
  // fetch actually resolved into a "done" job — checked via the SWR cache
  // entry, not the DOM, which wouldn't distinguish the two states.
  await waitFor(() => {
    expect(cache.get("/api/jobs/current")?.data?.status).toBe("done");
  });
  expect(screen.queryByText(/failed to analyze/)).not.toBeInTheDocument();
});

it("stays quiet when the finished run's progress has no videos_failed key at all", async () => {
  // Jobs created before this field existed, and discover/load_older jobs,
  // never set videos_failed — the `?? 0` guard at refresh-button.tsx:93
  // exists for exactly this shape, so it must be exercised without the key
  // present rather than just with it set to 0.
  const job = {
    id: 1,
    kind: "analyze",
    status: "done",
    progress: {
      stage: "analyzing",
      videos_done: 3,
      videos_total: 3,
    },
    started_at: "2026-08-03T00:00:00Z",
    finished_at: "2026-08-03T00:01:00Z",
    error_message: null,
  };
  apiFetchMock.mockResolvedValue(job);
  const cache = new Map();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ provider: () => cache }}>
        <RefreshButton />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  // Same proof-of-load requirement as the test above: a job with no
  // videos_failed key renders identically to no job having loaded yet, so
  // confirm the fetch actually settled into a "done" job via the SWR cache.
  await waitFor(() => {
    expect(cache.get("/api/jobs/current")?.data?.status).toBe("done");
  });
  expect(screen.queryByText(/failed to analyze/)).not.toBeInTheDocument();
});
