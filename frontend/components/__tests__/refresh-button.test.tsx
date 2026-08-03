import { render, screen } from "@testing-library/react";
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
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ provider: () => new Map() }}>
        <RefreshButton />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
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
  wrap(0);
  expect(await screen.findByText("Check new videos")).toBeInTheDocument();
  expect(screen.queryByText(/failed to analyze/)).not.toBeInTheDocument();
});
