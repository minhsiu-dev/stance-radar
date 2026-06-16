import type { HoldingItem } from "@/lib/types";

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
