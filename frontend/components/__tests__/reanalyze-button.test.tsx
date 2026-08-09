import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { ReanalyzeButton } from "@/components/reanalyze-button";

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const messages = {
  VideoDetail: {
    reanalyze: "Re-analyze",
    reanalyzing: "Re-analyzing…",
    reanalyzeFailed: "Re-analysis failed",
  },
};

const doneJob = {
  id: 42,
  kind: "analyze",
  status: "done",
  progress: {},
  started_at: "2026-08-09T00:00:00Z",
  finished_at: "2026-08-09T00:01:00Z",
  error_message: null,
};

function renderButton(onDone: () => void) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher: () => doneJob, provider: () => new Map() }}>
        <ReanalyzeButton videoId="vid-1" onDone={onDone} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
  apiFetchMock.mockReset();
});

describe("ReanalyzeButton", () => {
  it("posts the video id and calls onDone once its own job id reports finished", async () => {
    apiFetchMock.mockResolvedValue({ job_id: 42, created: true });
    const onDone = vi.fn();
    renderButton(onDone);

    await userEvent.click(screen.getByRole("button"));

    expect(apiFetchMock).toHaveBeenCalledWith("/api/videos/analyze", {
      method: "POST",
      body: JSON.stringify({ video_ids: ["vid-1"] }),
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("surfaces a trigger failure instead of hanging in the working state", async () => {
    apiFetchMock.mockRejectedValue(new Error("nope"));
    renderButton(vi.fn());

    await userEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("nope")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button")).not.toBeDisabled(),
    );
  });

  it("renders nothing when not authenticated", () => {
    useAdmin.mockReturnValue({ authenticated: false, handleAuthError: vi.fn() });
    renderButton(vi.fn());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
