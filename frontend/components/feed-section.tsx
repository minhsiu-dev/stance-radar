"use client";

import { useState } from "react";
import { FeedList, NO_FILTERS, type FeedFilters } from "@/components/feed-list";

// Feed 篩選狀態的擁有者。ticker 篩選由 feed 內的下拉 + 可移除 chip 控制。
export function FeedSection() {
  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);

  return <FeedList filters={filters} onFiltersChange={setFilters} />;
}
