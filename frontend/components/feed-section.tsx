"use client";

import { useState } from "react";
import { FeedList, NO_FILTERS, type FeedFilters } from "@/components/feed-list";
import { TrendingStocks } from "@/components/trending-stocks";

// Trending pills 與 feed filter 共用同一份 FeedFilters state:
// 點 pill = 設定 ticker filter;feed 內 dropdown 改 ticker 也會同步反映在 pill 上
export function FeedSection() {
  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);

  return (
    <>
      <TrendingStocks
        selected={filters.ticker === "all" ? null : filters.ticker}
        onSelect={(t) => setFilters({ ...filters, ticker: t ?? "all" })}
      />
      <FeedList filters={filters} onFiltersChange={setFilters} />
    </>
  );
}
