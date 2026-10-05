import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PipelinePage } from "@/components/pipeline/pipeline-page";
import type { PipelineSnapshot } from "@/lib/types";
import { messages, snapshot } from "./pipeline-fixtures";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/refresh-button", () => ({
  RefreshButton: () => <button type="button">Check new videos</button>,
}));
vi.mock("@/components/auto-refresh-hint", () => ({ AutoRefreshHint: () => null }));
vi.mock("@/components/failed-videos", () => ({
  FailedVideos: ({ kind }: { kind: string }) => <p>failed list for {kind}</p>,
}));

const admin = { ready: true, authenticated: true, promptUnlock: vi.fn(), handleAuthError: vi.fn() };
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => admin }));

function renderPage(data: PipelineSnapshot | Error = snapshot()) {
  const fetcher = vi.fn((key: string) => {
    if (key === "/api/pipeline") {
      return data instanceof Error ? Promise.reject(data) : Promise.resolve(data);
    }
    return Promise.resolve({ total: 0, groups: [] });
  });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map(), dedupingInterval: 0 }}>
        <PipelinePage />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return fetcher;
}

beforeEach(() => {
  admin.ready = true;
  admin.authenticated = true;
  admin.promptUnlock.mockReset();
});

describe("PipelinePage", () => {
  it("asks to unlock instead of loading anything while locked", async () => {
    admin.authenticated = false;
    const fetcher = renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(admin.promptUnlock).toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalledWith("/api/pipeline");
  });

  it("lays out the inbox, both lanes and the finished bucket", async () => {
    renderPage(snapshot({ analysis: { failed: 7 } }));
    expect(await screen.findByRole("region", { name: "① To decide" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "② Transcripts" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "③ Analysis" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Just finished" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check new videos" })).toBeInTheDocument();
  });

  it("opens the failure drawer on the lane whose count was clicked", async () => {
    renderPage(snapshot({ analysis: { failed: 7 } }));
    await userEvent.click(await screen.findByRole("button", { name: /7 failed/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Analysis failures");
    expect(screen.getByText("failed list for analysis")).toBeInTheDocument();
  });

  it("shows a load error", async () => {
    renderPage(new Error("api down"));
    expect(await screen.findByText("Failed to load: api down")).toBeInTheDocument();
  });
});
