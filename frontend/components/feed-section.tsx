"use client";

import { useState } from "react";
import { FeedList, NO_FILTERS, toggleTicker, type FeedFilters } from "@/components/feed-list";
import { DiscussedStrip } from "@/components/discussed-strip";

export function FeedSection() {
  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);
  const toggle = (ticker: string) =>
    setFilters((f) => ({ ...f, tickers: toggleTicker(f.tickers, ticker) }));
  return (
    <div className="space-y-4">
      <DiscussedStrip selected={filters.tickers} onToggle={toggle} />
      <FeedList filters={filters} onFiltersChange={setFilters} />
    </div>
  );
}
