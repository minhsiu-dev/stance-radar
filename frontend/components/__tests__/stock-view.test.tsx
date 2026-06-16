import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// Mutable spy containers shared between mock factories and tests
const capturedPriceChartProps: Array<{
  hoveredVideoId?: string | null;
  onSelectVideo?: (id: string) => void;
  height?: number;
  stanceFilter?: string;
  channelFilter?: string;
}> = [];
let capturedMentionsRowHover: ((id: string | null) => void) | null = null;
let capturedMentionsSelectedVideoId: string | null = "untouched";
let capturedMentionsStanceChange: ((v: string) => void) | null = null;
let capturedMentionsChannelChange: ((v: string) => void) | null = null;

vi.mock("@/components/price-chart", () => ({
  PriceChart: (props: {
    ticker?: string;
    hoveredVideoId?: string | null;
    onSelectVideo?: (id: string) => void;
    height?: number;
    stanceFilter?: string;
    channelFilter?: string;
  }) => {
    capturedPriceChartProps.push({
      hoveredVideoId: props.hoveredVideoId,
      onSelectVideo: props.onSelectVideo,
      height: props.height,
      stanceFilter: props.stanceFilter,
      channelFilter: props.channelFilter,
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
    onStanceFilterChange,
    onChannelFilterChange,
  }: {
    onRowHover: (id: string | null) => void;
    selectedVideoId: string | null;
    onStanceFilterChange: (v: string) => void;
    onChannelFilterChange: (v: string) => void;
  }) => {
    capturedMentionsRowHover = onRowHover;
    capturedMentionsSelectedVideoId = selectedVideoId;
    capturedMentionsStanceChange = onStanceFilterChange;
    capturedMentionsChannelChange = onChannelFilterChange;
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
    capturedMentionsStanceChange = null;
    capturedMentionsChannelChange = null;
    searchParamsValue.current = new URLSearchParams();
  });

  it("renders chart, mentions, and overview all at once (no tabs)", () => {
    render(<StockView ticker="AAPL" />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByTestId("mentions")).toBeInTheDocument();
    expect(screen.getByTestId("overview")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("row hover from mentions propagates to chart hoveredVideoId", () => {
    const { rerender } = render(<StockView ticker="AAPL" />);
    expect(capturedPriceChartProps.at(-1)?.hoveredVideoId).toBeNull();
    expect(capturedMentionsRowHover).not.toBeNull();
    act(() => capturedMentionsRowHover!("vid-42"));
    rerender(<StockView ticker="AAPL" />);
    expect(capturedPriceChartProps.at(-1)?.hoveredVideoId).toBe("vid-42");
  });

  it("marker click from chart propagates selectedVideoId to mentions", () => {
    const { rerender } = render(<StockView ticker="AAPL" />);
    const onSelectVideo = capturedPriceChartProps.at(-1)?.onSelectVideo;
    expect(onSelectVideo).toBeDefined();
    act(() => onSelectVideo!("vid-77"));
    rerender(<StockView ticker="AAPL" />);
    expect(capturedMentionsSelectedVideoId).toBe("vid-77");
  });

  it("deep-links ?video= to the selected mention row", () => {
    searchParamsValue.current = new URLSearchParams("video=vid-99");
    render(<StockView ticker="AAPL" />);
    expect(screen.getByTestId("mentions")).toBeInTheDocument();
    expect(capturedMentionsSelectedVideoId).toBe("vid-99");
  });

  it("stance filter change from mentions propagates to the chart", () => {
    const { rerender } = render(<StockView ticker="AAPL" />);
    expect(capturedPriceChartProps.at(-1)?.stanceFilter).toBe("all");
    expect(capturedMentionsStanceChange).not.toBeNull();
    act(() => capturedMentionsStanceChange!("sell"));
    rerender(<StockView ticker="AAPL" />);
    expect(capturedPriceChartProps.at(-1)?.stanceFilter).toBe("sell");
  });

  it("channel filter change from mentions propagates to the chart", () => {
    const { rerender } = render(<StockView ticker="AAPL" />);
    expect(capturedPriceChartProps.at(-1)?.channelFilter).toBe("all");
    expect(capturedMentionsChannelChange).not.toBeNull();
    act(() => capturedMentionsChannelChange!("ch_xyz"));
    rerender(<StockView ticker="AAPL" />);
    expect(capturedPriceChartProps.at(-1)?.channelFilter).toBe("ch_xyz");
  });

  it("deep-links ?channel= to the channel filter", () => {
    searchParamsValue.current = new URLSearchParams("channel=ch_x");
    render(<StockView ticker="AAPL" />);
    expect(capturedPriceChartProps.at(-1)?.channelFilter).toBe("ch_x");
  });
});
