import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PerformanceCards } from "@/components/performance-cards";

const messages = {
  Dashboard: {
    performance: {
      portfolio: "My portfolio",
      empty: "No holdings yet",
      emptyCta: "Add transactions",
      loadError: "Failed: {message}",
    },
  },
};

function wrap(fetcher: () => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <PerformanceCards />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

const changes = { "1d": 0.8, "5d": 2.1, "1m": 4.3, "3m": -1.2, "6m": 9.8, ytd: 6.4, "1y": 18.2 };

describe("PerformanceCards", () => {
  it("renders portfolio, VOO and QQQ cards with range chips", async () => {
    wrap(vi.fn().mockResolvedValue({
      ranges: ["1d", "5d", "1m", "3m", "6m", "ytd", "1y"],
      portfolio: { total_value: 128430.5, changes },
      voo: { price: 512.3, changes },
      qqq: { price: 478.91, changes },
    }));
    expect(await screen.findByText("My portfolio")).toBeInTheDocument();
    expect(screen.getByText("VOO")).toBeInTheDocument();
    expect(screen.getByText("QQQ")).toBeInTheDocument();
    expect(screen.getAllByText("+4.3%").length).toBe(3); // 1m chip on each card
    expect(screen.getAllByText("-1.2%").length).toBe(3);
  });

  it("shows empty-portfolio hint when portfolio is null", async () => {
    wrap(vi.fn().mockResolvedValue({
      ranges: ["1d", "5d", "1m", "3m", "6m", "ytd", "1y"],
      portfolio: null,
      voo: { price: 512.3, changes },
      qqq: { price: 478.91, changes },
    }));
    expect(await screen.findByText("No holdings yet")).toBeInTheDocument();
    expect(screen.getByText("VOO")).toBeInTheDocument();
  });
});
