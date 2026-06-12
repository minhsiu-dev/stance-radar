"use client";

import { useCallback, useState } from "react";
import { MentionsTable } from "@/components/mentions-table";
import { PriceChart } from "@/components/price-chart";
import { StockHeader } from "@/components/stock-header";

export function StockView({ ticker }: { ticker: string }) {
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const handleSelect = useCallback((videoId: string) => {
    setSelectedVideoId(videoId);
  }, []);

  return (
    <div className="space-y-8">
      <StockHeader ticker={ticker} />
      <PriceChart ticker={ticker} onSelectVideo={handleSelect} />
      <MentionsTable ticker={ticker} selectedVideoId={selectedVideoId} />
    </div>
  );
}
