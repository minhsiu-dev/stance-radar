"use client";

import { useCallback, useState } from "react";
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
      {/* MentionsTable 在 Task 23 加入,selectedVideoId 屆時傳入 */}
      {selectedVideoId && <span className="hidden">{selectedVideoId}</span>}
    </div>
  );
}
