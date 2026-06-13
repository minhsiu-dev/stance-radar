"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { PriceChart } from "@/components/price-chart";
import { StockHeader } from "@/components/stock-header";
import { OverviewTab } from "@/components/overview-tab";
import { MentionsTab } from "@/components/mentions-tab";

export function StockView({ ticker }: { ticker: string }) {
  const params = useSearchParams();
  const deepLinkVideo = params.get("video");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(deepLinkVideo);
  const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <StockHeader ticker={ticker} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="lg:sticky lg:top-14">
            <PriceChart
              ticker={ticker}
              hoveredVideoId={hoveredVideoId}
              onSelectVideo={setSelectedVideoId}
            />
          </div>
        </div>
        <MentionsTab
          ticker={ticker}
          selectedVideoId={selectedVideoId}
          onRowHover={setHoveredVideoId}
        />
      </div>
      <OverviewTab ticker={ticker} />
    </div>
  );
}
