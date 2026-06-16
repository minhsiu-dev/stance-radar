import type { HoldingItem, SeriesPoint } from "@/lib/types";

export interface TodayPl {
  amount: number | null;
  percent: number | null;
}

/** Today's portfolio P/L, derived from each holding's price + change_percent.
 *  prev_price = price / (1 + change_percent/100); today$ = shares*(price-prev_price).
 *  Cash is excluded (it does not move intraday). Unquoted holdings contribute 0. */
export function todayPl(holdings: HoldingItem[]): TodayPl {
  let amount = 0;
  let prevValue = 0;
  let any = false;
  for (const h of holdings) {
    if (h.price == null || h.change_percent == null) continue;
    const prevPrice = h.price / (1 + h.change_percent / 100);
    if (!Number.isFinite(prevPrice)) continue; // e.g. change_percent === -100 -> divide by zero
    amount += h.shares * (h.price - prevPrice);
    prevValue += h.shares * prevPrice;
    any = true;
  }
  if (!any) return { amount: null, percent: null };
  return { amount, percent: prevValue ? (amount / prevValue) * 100 : null };
}

export interface PerformanceRow {
  date: string;
  portfolio?: number;
  voo?: number;
  qqq?: number;
}

/** Merge portfolio/voo/qqq base-100 series by date, converting each to return %
 *  (value − 100). Missing points are simply omitted for that key on that date. */
export function mergePerformance(
  portfolio: SeriesPoint[] | null,
  voo: SeriesPoint[] | null,
  qqq: SeriesPoint[] | null,
): PerformanceRow[] {
  const rows = new Map<string, PerformanceRow>();
  const put = (key: "portfolio" | "voo" | "qqq", points: SeriesPoint[] | null) => {
    for (const p of points ?? []) {
      const row = rows.get(p.date) ?? { date: p.date };
      row[key] = Math.round((p.value - 100) * 100) / 100;
      rows.set(p.date, row);
    }
  };
  put("portfolio", portfolio);
  put("voo", voo);
  put("qqq", qqq);
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface CategoryBreakdown {
  byCategory: Record<string, number>;
  uncategorized: number;
  cash: number;
}

/** Group holdings' market value by assigned category id; unassigned tickers go to
 *  `uncategorized`. Cash is passed through unchanged. */
export function categoryBreakdown(
  holdings: HoldingItem[],
  cash: number,
  assignments: Record<string, string>,
): CategoryBreakdown {
  const byCategory: Record<string, number> = {};
  let uncategorized = 0;
  for (const h of holdings) {
    const mv = h.market_value ?? 0;
    const cat = assignments[h.ticker];
    if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + mv;
    else uncategorized += mv;
  }
  return { byCategory, uncategorized, cash };
}
