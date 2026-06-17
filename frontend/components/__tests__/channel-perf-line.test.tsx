import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

const swrResponses: Record<string, unknown> = {};
vi.mock("swr", () => ({
  default: (key: string) => ({ data: swrResponses[key] }),
}));

import { ChannelPerfLine } from "@/components/channel-perf-line";

const empties = {
  now: { win_rate: null, avg: null, median: null, n: 0 },
  "30": { win_rate: null, avg: null, median: null, n: 0 },
  "90": { win_rate: null, avg: null, median: null, n: 0 },
};
const base = {
  benchmark: "VOO",
  window_days: 180,
  horizons: ["now", "30", "90"],
  summary: {
    all: { ...empties, now: { win_rate: 58, avg: 4.1, median: 3.2, n: 37 } },
    buy: empties,
    sell: empties,
  },
  counts: { all: 37, buy: 20, sell: 17 },
};

describe("ChannelPerfLine", () => {
  it("renders win rate and median for the all/now slice", () => {
    swrResponses["/api/channels/ch1/performance"] = base;
    render(<ChannelPerfLine channelId="ch1" />);
    const line = screen.getByTestId("channel-perf-line").textContent ?? "";
    expect(line).toContain("58%");
    expect(line).toContain("+3.2%");
  });

  it("renders nothing when there are no calls", () => {
    swrResponses["/api/channels/ch2/performance"] = {
      ...base,
      counts: { all: 0, buy: 0, sell: 0 },
    };
    const { container } = render(<ChannelPerfLine channelId="ch2" />);
    expect(container.querySelector('[data-testid="channel-perf-line"]')).toBeNull();
  });

  it("renders nothing when calls exist but none have settled returns (now.n === 0)", () => {
    swrResponses["/api/channels/ch3/performance"] = {
      ...base,
      summary: { ...base.summary, all: { ...empties } },
      counts: { all: 5, buy: 3, sell: 2 },
    };
    const { container } = render(<ChannelPerfLine channelId="ch3" />);
    expect(
      container.querySelector('[data-testid="channel-perf-line"]'),
    ).toBeNull();
  });
});
