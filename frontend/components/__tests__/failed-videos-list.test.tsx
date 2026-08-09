import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { FailedVideosList } from "@/components/failed-videos-list";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));

const messages = {
  Failed: {
    loadError: "Failed to load: {message}",
    retryOne: "Retry",
    loadMore: "Load more",
    attempts: "{count} attempts · last {date}",
    attemptsNever: "{count} attempts · not retried yet",
    noneMatchFilter: "No videos match the current filter.",
  },
};

function item(id: string, attempts: number, last: string | null) {
  return {
    id,
    title: `Title ${id}`,
    thumbnail_url: "",
    channel: { id: "ch-a", title: "Alpha" },
    published_at: "2026-06-01T00:00:00Z",
    duration_seconds: 600,
    error_message: "claude exited -11",
    analysis_attempts: attempts,
    last_attempt_at: last,
  };
}

function renderList(fetcher: (key: string) => unknown, onRetry = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <FailedVideosList
          filter={{ kind: "analysis" }}
          disabled={false}
          onRetry={onRetry}
        />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return onRetry;
}

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true });
});

describe("FailedVideosList", () => {
  it("renders rows with attempt counts and the error message", async () => {
    renderList(async () => ({
      items: [item("v1", 3, "2026-08-05T00:00:00Z"), item("v2", 1, null)],
      total: 2,
      page: 1,
      page_size: 20,
    }));

    expect(await screen.findByText("Title v1")).toBeInTheDocument();
    expect(screen.getByText("Alpha · 2026-06-01 · 3 attempts · last 2026-08-05"))
      .toBeInTheDocument();
    expect(screen.getByText("Alpha · 2026-06-01 · 1 attempts · not retried yet"))
      .toBeInTheDocument();
    expect(screen.getAllByText("claude exited -11")).toHaveLength(2);
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/videos/v1");
  });

  it("requests the kind-filtered key", async () => {
    const fetcher = vi.fn(async () => ({
      items: [item("v1", 1, null)], total: 1, page: 1, page_size: 20,
    }));
    renderList(fetcher);
    await screen.findByText("Title v1");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/videos/failures/items?kind=analysis&page=1&page_size=20",
    );
  });

  it("hands the video id to onRetry", async () => {
    const onRetry = renderList(async () => ({
      items: [item("v1", 1, null)], total: 1, page: 1, page_size: 20,
    }));
    await screen.findByText("Title v1");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith("v1");
  });

  it("hides the retry button when not authenticated", async () => {
    useAdmin.mockReturnValue({ authenticated: false });
    renderList(async () => ({
      items: [item("v1", 1, null)], total: 1, page: 1, page_size: 20,
    }));
    await screen.findByText("Title v1");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("offers load more only while rows remain", async () => {
    renderList(async () => ({
      items: Array.from({ length: 20 }, (_, i) => item(`v${i}`, 1, null)),
      total: 45,
      page: 1,
      page_size: 20,
    }));
    expect(await screen.findByRole("button", { name: "Load more" }))
      .toBeInTheDocument();
  });

  it("hides load more once every row is already loaded", async () => {
    renderList(async () => ({
      items: Array.from({ length: 5 }, (_, i) => item(`v${i}`, 1, null)),
      total: 5,
      page: 1,
      page_size: 20,
    }));
    await screen.findByText("Title v0");
    expect(screen.queryByRole("button", { name: "Load more" }))
      .not.toBeInTheDocument();
  });

  it("keeps already-loaded rows visible when a later page fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => item(`v${i}`, 1, null)),
        total: 45,
        page: 1,
        page_size: 20,
      })
      .mockRejectedValueOnce(new Error("boom"));
    renderList(fetcher);

    await screen.findByText("Title v0");
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Failed to load: boom")).toBeInTheDocument();
    expect(screen.getByText("Title v0")).toBeInTheDocument();
    expect(screen.getByText("Title v19")).toBeInTheDocument();
  });

  it("shows an empty-state message when the filter matches nothing", async () => {
    renderList(async () => ({ items: [], total: 0, page: 1, page_size: 20 }));
    expect(
      await screen.findByText("No videos match the current filter."),
    ).toBeInTheDocument();
  });
});
