import { describe, expect, it } from "vitest";
import { bucketTotal, maxBucketTotal } from "@/lib/stance-buckets";
import type { StanceBucket, TrendingStock } from "@/lib/types";

const B = (over: Partial<StanceBucket>): StanceBucket => ({
  start: "2026-06-01T00:00:00+00:00", end: "2026-06-08T00:00:00+00:00",
  granularity: "week",
  buy_new: 0, buy_repeat: 0,
  neutral_new: 0, neutral_repeat: 0,
  sell_new: 0, sell_repeat: 0,
  ...over,
});

const stock = (buckets: StanceBucket[]): TrendingStock => ({
  ticker: "T", channel_count: 1, mention_count: 1, score: 1,
  last_mentioned_at: "2026-06-11T00:00:00Z",
  stances: {
    buy: { count: 0, avatars: [] },
    neutral: { count: 0, avatars: [] },
    sell: { count: 0, avatars: [] },
  },
  buckets,
});

describe("bucketTotal", () => {
  it("sums all six stance/kind counters", () => {
    expect(bucketTotal(B({
      buy_new: 1, buy_repeat: 2, neutral_new: 3,
      neutral_repeat: 4, sell_new: 5, sell_repeat: 6,
    }))).toBe(21);
  });
});

describe("maxBucketTotal", () => {
  it("returns the tallest single bucket across all cards", () => {
    const items = [
      stock([B({ buy_new: 2 }), B({ sell_new: 7 })]),
      stock([B({ neutral_new: 4 })]),
    ];
    expect(maxBucketTotal(items)).toBe(7);
  });

  it("returns undefined for an empty set or all-zero buckets", () => {
    expect(maxBucketTotal([])).toBeUndefined();
    expect(maxBucketTotal([stock([B({})])])).toBeUndefined();
  });
});
