import { describe, expect, it } from "vitest";
import { todayPl } from "@/lib/portfolio";
import type { HoldingItem } from "@/lib/types";

function holding(p: Partial<HoldingItem>): HoldingItem {
  return {
    ticker: "X", shares: 0, avg_cost: 0, price: null, change_percent: null,
    market_value: null, unrealized_pl: null, unrealized_pl_percent: null,
    weight: null, ...p,
  };
}

describe("todayPl", () => {
  it("sums today's dollar change and computes % over prior value", () => {
    // AAPL: 10 sh @ 150, +2% today  -> prev 147.06..., today$ = 10*(150-147.06)=29.41
    // MSFT: 5 sh @ 100, -1% today   -> prev 101.01..., today$ = 5*(100-101.01)=-5.05
    const r = todayPl([
      holding({ ticker: "AAPL", shares: 10, price: 150, change_percent: 2 }),
      holding({ ticker: "MSFT", shares: 5, price: 100, change_percent: -1 }),
    ]);
    expect(r.amount).toBeCloseTo(24.36, 1);
    expect(r.percent).toBeCloseTo(1.23, 1);
  });

  it("skips holdings without a quote", () => {
    const r = todayPl([
      holding({ ticker: "AAPL", shares: 10, price: 150, change_percent: 2 }),
      holding({ ticker: "NOQ", shares: 5, price: null, change_percent: null }),
    ]);
    expect(r.amount).toBeCloseTo(29.41, 1);
  });

  it("returns nulls when nothing is quoted", () => {
    expect(todayPl([holding({ price: null, change_percent: null })]))
      .toEqual({ amount: null, percent: null });
    expect(todayPl([])).toEqual({ amount: null, percent: null });
  });

  it("skips a holding with change_percent of -100 (delisted, would divide by zero)", () => {
    const r = todayPl([
      holding({ ticker: "DEAD", shares: 10, price: 0, change_percent: -100 }),
      holding({ ticker: "AAPL", shares: 10, price: 150, change_percent: 2 }),
    ]);
    expect(Number.isFinite(r.amount!)).toBe(true);
    expect(r.amount).toBeCloseTo(29.41, 1); // only AAPL contributes
  });
});
