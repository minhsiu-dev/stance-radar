import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mutable spy containers shared between mock factories and tests
const capturedPriceChartProps: Array<{
  hoveredVideoId?: string | null;
  onSelectVideo?: (id: string) => void;
  height?: number;
}> = [];
let capturedMentionsRowHover: ((id: string | null) => void) | null = null;
let capturedMentionsSelectedVideoId: string | null = "untouched";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/lib/use-sticky-collapse", () => ({
  useStickyCollapse: () => ({ sentinelRef: { current: null }, collapsed: false }),
}));
vi.mock("@/components/price-chart", () => ({
  PriceChart: (props: {
    ticker?: string;
    hoveredVideoId?: string | null;
    onSelectVideo?: (id: string) => void;
    height?: number;
  }) => {
    capturedPriceChartProps.push({
      hoveredVideoId: props.hoveredVideoId,
      onSelectVideo: props.onSelectVideo,
      height: props.height,
    });
    return <div data-testid="chart" />;
  },
}));
vi.mock("@/components/stock-header", () => ({
  StockHeader: () => <div data-testid="header" />,
}));
vi.mock("@/components/overview-tab", () => ({
  OverviewTab: () => <div data-testid="overview" />,
}));
vi.mock("@/components/mentions-tab", () => ({
  MentionsTab: ({
    onRowHover,
    selectedVideoId,
  }: {
    onRowHover: (id: string | null) => void;
    selectedVideoId: string | null;
  }) => {
    capturedMentionsRowHover = onRowHover;
    capturedMentionsSelectedVideoId = selectedVideoId;
    return <div data-testid="mentions" />;
  },
}));
const searchParamsValue = vi.hoisted(() => ({ current: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsValue.current,
}));

import { StockView } from "@/components/stock-view";

describe("StockView", () => {
  beforeEach(() => {
    capturedPriceChartProps.length = 0;
    capturedMentionsRowHover = null;
    capturedMentionsSelectedVideoId = "untouched";
    searchParamsValue.current = new URLSearchParams();
  });

  it("renders chart above tabs and overview by default", () => {
    render(<StockView ticker="AAPL" />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByTestId("overview")).toBeInTheDocument();
  });

  it("wraps header + chart in a sticky container", () => {
    render(<StockView ticker="AAPL" />);
    expect(screen.getByTestId("stock-sticky").className).toContain("sticky");
  });

  it("passes full height 380 to PriceChart when not collapsed", () => {
    render(<StockView ticker="AAPL" />);
    expect(capturedPriceChartProps.at(-1)?.height).toBe(380);
  });

  it("switches to Mentions tab", () => {
    render(<StockView ticker="AAPL" />);
    fireEvent.click(screen.getByRole("tab", { name: "mentions" }));
    expect(screen.getByTestId("mentions")).toBeInTheDocument();
  });

  it("row hover from mentions tab propagates to chart hoveredVideoId", async () => {
    const { rerender } = render(<StockView ticker="AAPL" />);

    // Switch to Mentions tab to mount MentionsTab
    fireEvent.click(screen.getByRole("tab", { name: "mentions" }));

    // Initial hoveredVideoId should be null
    expect(capturedPriceChartProps.at(-1)?.hoveredVideoId).toBeNull();

    // Simulate row hover from MentionsTab calling onRowHover
    expect(capturedMentionsRowHover).not.toBeNull();
    act(() => {
      capturedMentionsRowHover!("vid-42");
    });

    // Force re-render so parent state propagates to PriceChart props
    rerender(<StockView ticker="AAPL" />);
    expect(capturedPriceChartProps.at(-1)?.hoveredVideoId).toBe("vid-42");
  });

  it("opens the Mentions tab with the deep-linked video selected", () => {
    searchParamsValue.current = new URLSearchParams("video=vid-99");
    render(<StockView ticker="AAPL" />);
    expect(screen.getByTestId("mentions")).toBeInTheDocument();
    expect(capturedMentionsSelectedVideoId).toBe("vid-99");
  });

  it("marker click from chart propagates selectedVideoId to mentions tab", async () => {
    const { rerender } = render(<StockView ticker="AAPL" />);

    // PriceChart is mounted unconditionally (above Tabs), so its props are
    // captured on initial render — no need to switch tabs first.
    const onSelectVideo = capturedPriceChartProps.at(-1)?.onSelectVideo;
    expect(onSelectVideo).toBeDefined();

    // Calling onSelectVideo should ALSO auto-switch the active tab to mentions.
    act(() => {
      onSelectVideo!("vid-77");
    });

    // Re-render to flush state updates.
    rerender(<StockView ticker="AAPL" />);

    // The mentions tab content must now be visible (auto-switch happened).
    expect(screen.getByTestId("mentions")).toBeInTheDocument();
    // And the selected video id must have been propagated to MentionsTab.
    expect(capturedMentionsSelectedVideoId).toBe("vid-77");
  });
});
