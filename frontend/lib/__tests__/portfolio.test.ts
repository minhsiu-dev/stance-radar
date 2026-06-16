import { describe, expect, it } from "vitest";
import { todayPl, mergePerformance, categoryBreakdown } from "@/lib/portfolio";
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

describe("mergePerformance", () => {
  it("merges by date and converts base-100 values to return %", () => {
    const rows = mergePerformance(
      [{ date: "2026-01-01", value: 100 }, { date: "2026-01-02", value: 105 }],
      [{ date: "2026-01-01", value: 100 }, { date: "2026-01-02", value: 102 }],
      [{ date: "2026-01-02", value: 110 }],
    );
    expect(rows).toEqual([
      { date: "2026-01-01", portfolio: 0, voo: 0 },
      { date: "2026-01-02", portfolio: 5, voo: 2, qqq: 10 },
    ]);
  });

  it("handles null series", () => {
    expect(mergePerformance(null, [{ date: "2026-01-01", value: 100 }], null))
      .toEqual([{ date: "2026-01-01", voo: 0 }]);
  });

  it("returns [] when all series are null", () => {
    expect(mergePerformance(null, null, null)).toEqual([]);
  });

  it("rounds return % to 2 decimal places", () => {
    const rows = mergePerformance([{ date: "2026-01-01", value: 101.126 }], null, null);
    expect(rows).toEqual([{ date: "2026-01-01", portfolio: 1.13 }]);
  });

  it("sorts rows ascending by date regardless of input order", () => {
    const rows = mergePerformance(
      [{ date: "2026-01-03", value: 103 }, { date: "2026-01-01", value: 101 }],
      null, null,
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-01-01", "2026-01-03"]);
  });
});

describe("categoryBreakdown", () => {
  it("sums market value per category, plus uncategorized and cash", () => {
    const r = categoryBreakdown(
      [
        holding({ ticker: "AAPL", market_value: 1000 }),
        holding({ ticker: "MSFT", market_value: 500 }),
        holding({ ticker: "TSLA", market_value: 200 }), // unassigned
      ],
      300, // cash
      { AAPL: "c1", MSFT: "c1" },
    );
    expect(r.byCategory).toEqual({ c1: 1500 });
    expect(r.uncategorized).toBe(200);
    expect(r.cash).toBe(300);
  });

  it("treats a null market_value as 0", () => {
    const r = categoryBreakdown(
      [holding({ ticker: "X", market_value: null })], 0, {},
    );
    expect(r.uncategorized).toBe(0);
  });

  it("partitions across multiple categories", () => {
    const r = categoryBreakdown(
      [
        holding({ ticker: "AAPL", market_value: 1000 }),
        holding({ ticker: "TSLA", market_value: 200 }),
      ],
      0,
      { AAPL: "c1", TSLA: "c2" },
    );
    expect(r.byCategory).toEqual({ c1: 1000, c2: 200 });
  });

  it("handles empty holdings", () => {
    expect(categoryBreakdown([], 500, {})).toEqual({
      byCategory: {}, uncategorized: 0, cash: 500,
    });
  });
});
