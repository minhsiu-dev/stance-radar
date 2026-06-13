"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { PriceChart } from "@/components/price-chart";
import { StockHeader } from "@/components/stock-header";
import { OverviewTab } from "@/components/overview-tab";
import { MentionsTab } from "@/components/mentions-tab";
import { useStickyCollapse } from "@/lib/use-sticky-collapse";

export function StockView({ ticker }: { ticker: string }) {
  const t = useTranslations("Stock.tabs");
  const params = useSearchParams();
  const deepLinkVideo = params.get("video");
  const [tab, setTab] = useState(deepLinkVideo ? "mentions" : "overview");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(deepLinkVideo);
  const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);
  const { sentinelRef, collapsed } = useStickyCollapse();
  const chartHeight = collapsed ? 150 : 380;

  return (
    <div className="relative space-y-6">
      <div ref={sentinelRef} aria-hidden className="pointer-events-none absolute left-0 top-48 h-px w-px" />
      <div
        data-testid="stock-sticky"
        className="sticky top-14 z-30 space-y-2 bg-background pb-2"
      >
        <StockHeader ticker={ticker} compact={collapsed} />
        <PriceChart
          ticker={ticker}
          height={chartHeight}
          hoveredVideoId={hoveredVideoId}
          onSelectVideo={(id) => {
            setSelectedVideoId(id);
            setTab("mentions");
          }}
        />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">{t("overview")}</TabsTrigger>
          <TabsTrigger value="mentions">{t("mentions")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab ticker={ticker} />
        </TabsContent>
        <TabsContent value="mentions">
          <MentionsTab
            ticker={ticker}
            selectedVideoId={selectedVideoId}
            onRowHover={setHoveredVideoId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
