import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { Inbox } from "@/components/pipeline/inbox";
import type { DiscoveredResponse } from "@/lib/types";
import { messages } from "./pipeline-fixtures";

const handleAuthError = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => ({ handleAuthError }) }));

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const response: DiscoveredResponse = {
  total: 3,
  groups: [
    {
      channel: { id: "UC_a", title: "Alpha", thumbnail_url: "" },
      videos: [
        { id: "v1", title: "Video 1", thumbnail_url: "", published_at: "2026-06-08T12:00:00Z",
          duration_seconds: 600, status: "discovered" },
        { id: "v2", title: "Video 2", thumbnail_url: "", published_at: "2026-06-07T12:00:00Z",
          duration_seconds: null, status: "discovered" },
      ],
    },
    {
      channel: { id: "UC_b", title: "Beta", thumbnail_url: "" },
      videos: [
        { id: "v3", title: "Video 3", thumbnail_url: "", published_at: "2026-06-06T12:00:00Z",
          duration_seconds: 300, status: "discovered" },
      ],
    },
  ],
};

function renderInbox(total = 3, fetcher = vi.fn().mockResolvedValue(response)) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map(), dedupingInterval: 0 }}>
        <Inbox total={total} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return fetcher;
}

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({});
  handleAuthError.mockReset();
});

describe("Inbox", () => {
  it("starts with nothing selected (opt-in)", async () => {
    renderInbox();
    expect(await screen.findByText("Video 1")).toBeInTheDocument();
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Send 0 · skip the rest" })).toBeInTheDocument();
  });

  it("counts what is checked, per video and per channel", async () => {
    renderInbox();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Video 3/ }));
    expect(screen.getByRole("button", { name: "Send 1 · skip the rest" })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Select all" })[0]);
    expect(screen.getByRole("button", { name: "Send 3 · skip the rest" })).toBeInTheDocument();
  });

  it("skips the unchecked, analyzes the checked, and stays on the page", async () => {
    renderInbox();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Video 1/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send 1 · skip the rest" }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(apiFetchMock.mock.calls[0]).toEqual([
      "/api/videos/skip",
      { method: "POST", body: JSON.stringify({ video_ids: ["v2", "v3"] }) },
    ]);
    expect(apiFetchMock.mock.calls[1]).toEqual([
      "/api/videos/analyze",
      { method: "POST", body: JSON.stringify({ video_ids: ["v1"] }) },
    ]);
  });

  it("shows a failed submit and routes a 401 through handleAuthError", async () => {
    apiFetchMock.mockRejectedValue(new Error("boom"));
    renderInbox();
    await userEvent.click(await screen.findByRole("button", { name: "Send 0 · skip the rest" }));
    expect(await screen.findByText("Submit failed: boom")).toBeInTheDocument();
    expect(handleAuthError).toHaveBeenCalled();
  });

  it("collapses to one line, without fetching, when nothing waits", () => {
    const fetcher = renderInbox(0);
    expect(screen.getByText("Nothing waiting for a decision")).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("can be collapsed by hand", async () => {
    renderInbox();
    await screen.findByText("Video 1");
    await userEvent.click(screen.getByRole("button", { name: /Hide/ }));
    expect(screen.queryByText("Video 1")).toBeNull();
  });
});
