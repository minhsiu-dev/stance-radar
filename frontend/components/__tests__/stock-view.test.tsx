import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mutable spy containers shared between mock factories and tests
const capturedPriceChartProps: Array<{
  hoveredVideoId?: string | null;
  onSelectVideo?: (id: string) => void;
}> = [];
let capturedMentionsRowHover: ((id: string | null) => void) | null = null;
let capturedMentionsSelectedVideoId: string | null = "untouched";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/components/price-chart", () => ({
  PriceChart: (props: {
    ticker?: string;
    hoveredVideoId?: string | null;
    onSelectVideo?: (id: string) => void;
  }) => {
    capturedPriceChartProps.push({
      hoveredVideoId: props.hoveredVideoId,
      onSelectVideo: props.onSelectVideo,
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
vi.mock("@/components/financials-tab", () => ({
  FinancialsTab: () => <div data-testid="financials" />,
}));

import { StockView } from "@/components/stock-view";

describe("StockView", () => {
  beforeEach(() => {
    capturedPriceChartProps.length = 0;
    capturedMentionsRowHover = null;
    capturedMentionsSelectedVideoId = "untouched";
  });

  it("renders chart above tabs and overview by default", () => {
    render(<StockView ticker="AAPL" />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByTestId("overview")).toBeInTheDocument();
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

  it("marker click from chart propagates selectedVideoId to mentions tab", async () => {
    const { rerender } = render(<StockView ticker="AAPL" />);

    // Switch to Mentions tab to mount MentionsTab
    fireEvent.click(screen.getByRole("tab", { name: "mentions" }));

    // Initial selectedVideoId should be null
    expect(capturedMentionsSelectedVideoId).toBeNull();

    // Grab onSelectVideo from the latest PriceChart render
    const onSelectVideo = capturedPriceChartProps.at(-1)?.onSelectVideo;
    expect(onSelectVideo).toBeDefined();

    act(() => {
      onSelectVideo!("vid-77");
    });

    // Re-render to flush state update
    rerender(<StockView ticker="AAPL" />);
    expect(capturedMentionsSelectedVideoId).toBe("vid-77");
  });
});
