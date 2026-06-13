import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { StockHeader } from "@/components/stock-header";

const messages = {
  Stock: {
    header: {
      marketCap: "Mkt Cap",
      peRatio: "P/E",
      peLabelTF: "P/E (T / F)",
      peTooltip: "Trailing / Forward",
      eps: "EPS",
      week52Range: "52w",
      volume: "Vol",
      dividendYield: "Div",
      loadError: "Error: {message}",
      externalData: "StockAnalysis",
    },
  },
};

const base = {
  ticker: "AAPL", name: "Apple", price: 100, change: 1, change_percent: 1,
  market_cap: 1e12, eps: 5, week52_high: 110, week52_low: 90,
  volume: 1e6, dividend_yield: 0.5,
};

describe("StockHeader external link", () => {
  it("links to StockAnalysis for the ticker (lowercased, new tab)", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ...base, ticker: "ZS", pe_ratio: 27.5, forward_pe: null,
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ fetcher, provider: () => new Map() }}>
          <StockHeader ticker="ZS" />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    const link = await screen.findByRole("link", { name: /StockAnalysis/i });
    expect(link.getAttribute("href")).toBe("https://stockanalysis.com/stocks/zs/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("StockHeader P/E rendering", () => {
  it("shows trailing/forward pair when forward_pe present", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ...base, pe_ratio: 27.5, forward_pe: 23.4,
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ fetcher, provider: () => new Map() }}>
          <StockHeader ticker="AAPL" />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText(/27\.50\s*\/\s*23\.40/)).toBeInTheDocument();
  });

  it("falls back to trailing only when forward_pe is null", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ...base, pe_ratio: 27.5, forward_pe: null,
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ fetcher, provider: () => new Map() }}>
          <StockHeader ticker="AAPL" />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText("27.50")).toBeInTheDocument();
  });
});
