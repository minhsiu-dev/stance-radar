import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
const swrResponses: Record<string, unknown> = {};
vi.mock("swr", () => ({
  default: (key: string) => ({ data: swrResponses[key], error: undefined }),
}));

import { ChannelTickerTable } from "@/components/channel-ticker-table";

function slice(n: number, win: number | null, alpha: number | null, ret: number | null, pending = 0) {
  return { n, win_rate: win, avg_alpha: alpha, avg_return: ret, pending };
}
const rows = [
  { ticker: "AAA", videos: 3, buy: 2, neutral: 1, sell: 0, latest_stance: "buy", latest_date: "2026-06-01",
    perf: { all: slice(2, 50, 4.2, 9.1), buy: slice(2, 50, 4.2, 9.1), sell: slice(0, null, null, null) },
    perf_incl: { all: slice(3, 33.3, 1.0, 2.0), buy: slice(3, 33.3, 1.0, 2.0), sell: slice(0, null, null, null) } },
  { ticker: "BBB", videos: 9, buy: 1, neutral: 0, sell: 8, latest_stance: "sell", latest_date: "2026-06-10",
    perf: { all: slice(9, 25, -3.1, -5.0), buy: slice(1, 100, 8.0, 8.0), sell: slice(8, 12.5, -4.0, -6.0) },
    perf_incl: { all: slice(9, 25, -3.1, -5.0), buy: slice(1, 100, 8.0, 8.0), sell: slice(8, 12.5, -4.0, -6.0) } },
  { ticker: "CCC", videos: 1, buy: 0, neutral: 1, sell: 0, latest_stance: "neutral", latest_date: "2026-05-01",
    perf: { all: slice(0, null, null, null, 2), buy: slice(0, null, null, null, 2), sell: slice(0, null, null, null) },
    perf_incl: { all: slice(2, 50, 1.0, 1.0, 0), buy: slice(2, 50, 1.0, 1.0, 0), sell: slice(0, null, null, null) } },
];
function tickerOrder(): string[] {
  return screen.getAllByTestId(/^ticker-row-/).map((el) => el.getAttribute("data-ticker")!);
}

describe("ChannelTickerTable", () => {
  it("renders rows default-sorted by videos desc and shows avg_return", () => {
    swrResponses["/api/channels/ch1/tickers"] = rows;
    render(<ChannelTickerTable channelId="ch1" />);
    expect(tickerOrder()).toEqual(["BBB", "AAA", "CCC"]);
    // AAA all-slice avg_return 9.1 rendered
    expect(within(screen.getByTestId("ticker-row-AAA")).getByText("+9.1")).toBeInTheDocument();
  });

  it("re-slices perf columns when the buy/sell toggle changes", () => {
    swrResponses["/api/channels/ch1/tickers"] = rows;
    render(<ChannelTickerTable channelId="ch1" />);
    // default = all: BBB win_rate 25%
    expect(within(screen.getByTestId("ticker-row-BBB")).getByText("25%")).toBeInTheDocument();
    // switch to buy: BBB buy-slice win_rate 100%
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(within(screen.getByTestId("ticker-row-BBB")).getByText("100%")).toBeInTheDocument();
    // switch to sell: AAA has no sell calls -> em dash
    fireEvent.click(screen.getByRole("button", { name: "sell" }));
    const aaa = screen.getByTestId("ticker-row-AAA");
    expect(within(aaa).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("sorts by avg_return on the active slice, nulls last", () => {
    swrResponses["/api/channels/ch1/tickers"] = rows;
    render(<ChannelTickerTable channelId="ch1" />);
    fireEvent.click(screen.getByRole("button", { name: "avgReturn" }));
    // all-slice avg_return desc: AAA(9.1), BBB(-5.0), CCC(null last)
    expect(tickerOrder()).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("shows a pending annotation instead of an em dash when calls are pending", () => {
    swrResponses["/api/channels/ch1/tickers"] = rows;
    render(<ChannelTickerTable channelId="ch1" />);
    const ccc = screen.getByTestId("ticker-row-CCC");
    // samples cell surfaces the pending count (the mocked t() returns the raw key "pending")
    expect(within(ccc).getByText(/pending/)).toBeInTheDocument();
  });

  it("switches to the inclusive (min-90d) window when 含待定 is toggled", () => {
    swrResponses["/api/channels/ch1/tickers"] = rows;
    render(<ChannelTickerTable channelId="ch1" />);
    // default (matured): AAA all-slice win-rate 50%
    expect(within(screen.getByTestId("ticker-row-AAA")).getByText("50%")).toBeInTheDocument();
    // CCC is all-pending under matured
    expect(within(screen.getByTestId("ticker-row-CCC")).getByText(/pending/)).toBeInTheDocument();
    // toggle 含待定 (the mocked t() returns the raw key "windowIncl")
    fireEvent.click(screen.getByRole("button", { name: "windowIncl" }));
    // incl: AAA win-rate now 33.3%, and CCC is counted (no pending annotation, win-rate 50%)
    expect(within(screen.getByTestId("ticker-row-AAA")).getByText("33.3%")).toBeInTheDocument();
    expect(within(screen.getByTestId("ticker-row-CCC")).getByText("50%")).toBeInTheDocument();
  });
});
