"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { PriceChart } from "@/components/price-chart";
import { StockHeader } from "@/components/stock-header";
import { OverviewTab } from "@/components/overview-tab";
import { MentionsTab } from "@/components/mentions-tab";
import type { StanceValue } from "@/lib/types";

export function StockView({ ticker }: { ticker: string }) {
  const params = useSearchParams();
  const deepLinkVideo = params.get("video");
  const deepLinkChannel = params.get("channel");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(deepLinkVideo);
  const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);
  const [stanceFilter, setStanceFilter] = useState<StanceValue | "all">("all");
  const [channelFilter, setChannelFilter] = useState<string>(deepLinkChannel ?? "all");

  return (
    <div className="space-y-6">
      <StockHeader ticker={ticker} />
      <div className="grid gap-6 lg:grid-cols-2">
        {/* min-w-0: let the grid item shrink below the chart's intrinsic
            (fixed-px) width so the container actually resizes on width change. */}
        <div className="min-w-0">
          <div className="lg:sticky lg:top-14">
            <PriceChart
              ticker={ticker}
              hoveredVideoId={hoveredVideoId}
              onSelectVideo={setSelectedVideoId}
              stanceFilter={stanceFilter}
              channelFilter={channelFilter}
            />
          </div>
        </div>
        <div className="min-w-0">
          <MentionsTab
            ticker={ticker}
            selectedVideoId={selectedVideoId}
            onRowHover={setHoveredVideoId}
            stanceFilter={stanceFilter}
            channelFilter={channelFilter}
            onStanceFilterChange={setStanceFilter}
            onChannelFilterChange={setChannelFilter}
          />
        </div>
      </div>
      <OverviewTab ticker={ticker} />
    </div>
  );
}
