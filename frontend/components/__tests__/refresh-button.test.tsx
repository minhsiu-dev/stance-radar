import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { RefreshButton } from "@/components/refresh-button";

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));

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
      triggerFailed: "Update failed",
      autoEvery: "Auto-refresh every {minutes} min",
      stages: {
        listing: "Checking channels {done}/{total}",
        preparing: "Preparing…",
      },
      noNew: "No new videos found",
    },
  },
};

beforeEach(() => {
  apiFetchMock.mockReset();
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
});

const runningJob = {
  id: 1,
  kind: "discover",
  status: "running",
  progress: { stage: "listing", channels_done: 0, channels_total: 2 },
  started_at: "2026-10-04T00:00:00Z",
  finished_at: null,
  error_message: null,
};

function renderButton() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ provider: () => new Map() }}>
        <RefreshButton />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

it("says so when a finished discover found nothing new", async () => {
  apiFetchMock.mockResolvedValueOnce(runningJob).mockResolvedValue({
    ...runningJob,
    status: "done",
    progress: { stage: "listing", channels_done: 2, channels_total: 2, discovered: 0 },
    finished_at: "2026-10-04T00:01:00Z",
  });
  renderButton();
  expect(await screen.findByRole("button", { name: /Checking channels 0\/2/ })).toBeDisabled();
  expect(
    await screen.findByText("No new videos found", {}, { timeout: 4000 }),
  ).toBeInTheDocument();
});

it("shows why the last update failed", async () => {
  apiFetchMock.mockResolvedValue({ ...runningJob, status: "failed", error_message: "quota exhausted" });
  renderButton();
  expect(await screen.findByText("Last update failed: quota exhausted")).toBeInTheDocument();
});
