import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { ReanalyzeButton } from "@/components/reanalyze-button";
import type { VideoStatus } from "@/lib/types";
import { snapshot } from "./pipeline-fixtures";

const handleAuthError = vi.fn();
vi.mock("@/components/admin-provider", () => ({
  useAdmin: () => ({ authenticated: true, handleAuthError }),
}));

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

let video: { status: VideoStatus; claimed: boolean } = { status: "analyzed", claimed: false };
let analysisPaused = false;

const fetcher = (key: string) =>
  Promise.resolve(
    key === "/api/pipeline"
      ? snapshot({ lanes: { analysis: { paused: analysisPaused } } })
      : {
          video: {
            id: "vid-1",
            title: "t",
            channel: { id: "c", title: "c", thumbnail_url: "" },
            published_at: "2026-10-01T00:00:00Z",
            duration_seconds: 60,
            tldr: null,
            ...video,
          },
          groups: [],
        },
  );

function renderButton(onDone = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ VideoDetail: en.VideoDetail }}>
      <SWRConfig value={{ fetcher, provider: () => new Map(), dedupingInterval: 0 }}>
        <ReanalyzeButton videoId="vid-1" onDone={onDone} pollMs={20} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return onDone;
}

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({ queued: 1, transcript: 0, analysis: 1 });
  handleAuthError.mockReset();
  video = { status: "analyzed", claimed: false };
  analysisPaused = false;
});

describe("ReanalyzeButton", () => {
  it("queues the video, follows it through the lane, and calls onDone at the end", async () => {
    const onDone = renderButton();
    video = { status: "transcribed", claimed: false };
    await userEvent.click(screen.getByRole("button", { name: "Re-analyze" }));

    expect(apiFetchMock).toHaveBeenCalledWith("/api/videos/analyze", {
      method: "POST",
      body: JSON.stringify({ video_ids: ["vid-1"] }),
    });
    expect(await screen.findByRole("button", { name: /Queued/ })).toBeDisabled();

    video = { status: "transcribed", claimed: true };
    expect(await screen.findByRole("button", { name: /Re-analyzing/ })).toBeDisabled();

    video = { status: "analyzed", claimed: false };
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Re-analyze" })).toBeEnabled();
  });

  it("says so when the lane it is waiting on is paused", async () => {
    analysisPaused = true;
    renderButton();
    video = { status: "transcribed", claimed: false };
    await userEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    expect(await screen.findByText("That stage is paused right now")).toBeInTheDocument();
  });

  it("reports a failed request and stays usable", async () => {
    apiFetchMock.mockRejectedValue(new Error("Videos are being processed: vid-1"));
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    expect(await screen.findByText("Videos are being processed: vid-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-analyze" })).toBeEnabled();
    expect(handleAuthError).toHaveBeenCalled();
  });
});
