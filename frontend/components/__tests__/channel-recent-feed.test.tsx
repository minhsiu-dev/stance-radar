import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
  default: () => ({
    data: infiniteData,
    error: undefined,
    setSize: vi.fn(),
    isValidating: false,
  }),
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
  page_size: 30,
  items: [
    { published_at: "2026-06-10T00:00:00Z", video_id: "v1", video_title: "Vid One",
      ticker: "AAA", stance: "buy", confidence: "high", summary: "bullish" },
    { published_at: "2026-06-08T00:00:00Z", video_id: "v2", video_title: "Vid Two",
      ticker: "BBB", stance: "neutral", confidence: null, summary: "wait and see" },
  ],
};

describe("ChannelRecentFeed", () => {
  it("renders a row per VideoStance with video + summary", () => {
    infiniteData = [page];
    render(<ChannelRecentFeed channelId="ch1" />);
    expect(screen.getByText("Vid One")).toBeInTheDocument();
    expect(screen.getByText("Vid Two")).toBeInTheDocument();
    expect(screen.getByText("bullish")).toBeInTheDocument();
  });

  it("shows the empty state when there are no items", () => {
    infiniteData = [{ total: 0, page: 1, page_size: 30, items: [] }];
    render(<ChannelRecentFeed channelId="ch1" />);
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});
