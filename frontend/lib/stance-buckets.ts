import type { StanceBucket, TrendingStock } from "@/lib/types";

export function bucketTotal(b: StanceBucket): number {
  return (
    b.buy_new + b.buy_repeat +
    b.neutral_new + b.neutral_repeat +
    b.sell_new + b.sell_repeat
  );
}

// Shared y-axis cap for a set of trending cards: the tallest single bucket
// across all loaded cards, so bar heights are comparable card-to-card.
// undefined (-> per-card auto-scale) when nothing has data.
export function maxBucketTotal(items: TrendingStock[]): number | undefined {
  let max = 0;
  for (const s of items) {
    for (const b of s.buckets) max = Math.max(max, bucketTotal(b));
  }
  return max > 0 ? max : undefined;
}
