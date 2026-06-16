"use client";

import { MentionsTable } from "@/components/mentions-table";
import type { StanceValue } from "@/lib/types";

export function MentionsTab({
  ticker,
  selectedVideoId,
  onRowHover,
  stanceFilter,
  channelFilter,
  onStanceFilterChange,
  onChannelFilterChange,
}: {
  ticker: string;
  selectedVideoId: string | null;
  onRowHover: (videoId: string | null) => void;
  stanceFilter: StanceValue | "all";
  channelFilter: string;
  onStanceFilterChange: (v: StanceValue | "all") => void;
  onChannelFilterChange: (v: string) => void;
}) {
  return (
    <MentionsTable
      ticker={ticker}
      selectedVideoId={selectedVideoId}
      onRowHover={onRowHover}
      stanceFilter={stanceFilter}
      channelFilter={channelFilter}
      onStanceFilterChange={onStanceFilterChange}
      onChannelFilterChange={onChannelFilterChange}
    />
  );
}
