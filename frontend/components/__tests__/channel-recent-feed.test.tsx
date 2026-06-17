import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
let infiniteData: unknown[] | undefined;
vi.mock("swr/infinite", () => ({
  default: () => ({ data: infiniteData, error: undefined, setSize: vi.fn(), isValidating: false }),
}));
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

import { ChannelRecentFeed } from "@/components/channel-recent-feed";

const page = {
  total: 2,
  page: 1,
  page_size: 20,
  items: [
    {
      video_id: "v1", video_title: "Vid One", published_at: "2026-06-10T00:00:00Z",
      stances: [
        { ticker: "AAA", stance: "buy", confidence: "high", summary: "bullish" },
        { ticker: "BBB", stance: "sell", confidence: null, summary: "bearish" },
      ],
    },
    {
      video_id: "v2", video_title: "Vid Two", published_at: "2026-06-08T00:00:00Z",
      stances: [{ ticker: "CCC", stance: "neutral", confidence: null, summary: "wait" }],
    },
  ],
};

describe("ChannelRecentFeed", () => {
  it("renders one block per video with all its ticker badges", () => {
    infiniteData = [page];
    render(<ChannelRecentFeed channelId="ch1" />);
    // titles once each
    expect(screen.getByText("Vid One")).toBeInTheDocument();
    expect(screen.getByText("Vid Two")).toBeInTheDocument();
    // the multi-ticker video's badges both render in its block
    const block = screen.getByTestId("recent-video-v1");
    expect(within(block).getByText(/AAA/)).toBeInTheDocument();
    expect(within(block).getByText(/BBB/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no items", () => {
    infiniteData = [{ total: 0, page: 1, page_size: 20, items: [] }];
    render(<ChannelRecentFeed channelId="ch1" />);
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});
