"use client";

import { MentionsTable } from "@/components/mentions-table";

export function MentionsTab({
  ticker,
  selectedVideoId,
  onRowHover,
}: {
  ticker: string;
  selectedVideoId: string | null;
  onRowHover: (videoId: string | null) => void;
}) {
  return (
    <MentionsTable
      ticker={ticker}
      selectedVideoId={selectedVideoId}
      onRowHover={onRowHover}
    />
  );
}
