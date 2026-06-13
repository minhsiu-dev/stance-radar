import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { Sparkline } from "@/components/sparkline";

function wrap(closes: number[]) {
  const fetcher = vi.fn().mockResolvedValue(
    closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 1 })),
  );
  return render(
    <SWRConfig value={{ fetcher, provider: () => new Map() }}>
      <Sparkline ticker="VOO" />
    </SWRConfig>,
  );
}

describe("Sparkline", () => {
  it("draws a green line when the day is up", async () => {
    wrap([100, 101, 103]);
    const line = await screen.findByTestId("sparkline-line");
    expect(line.getAttribute("stroke")).toBe("#10b981");
  });
  it("draws a red line when the day is down", async () => {
    wrap([103, 101, 100]);
    const line = await screen.findByTestId("sparkline-line");
    expect(line.getAttribute("stroke")).toBe("#ef4444");
  });
  it("renders nothing drawable with fewer than 2 points", async () => {
    wrap([100]);
    expect(await screen.findByTestId("sparkline-empty")).toBeInTheDocument();
  });
});
