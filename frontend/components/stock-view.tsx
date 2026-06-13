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

export function StockView({ ticker }: { ticker: string }) {
  const t = useTranslations("Stock.tabs");
  const params = useSearchParams();
  const deepLinkVideo = params.get("video");
  const [tab, setTab] = useState(deepLinkVideo ? "mentions" : "overview");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(deepLinkVideo);
  const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      <StockHeader ticker={ticker} />
      <PriceChart
        ticker={ticker}
        hoveredVideoId={hoveredVideoId}
        onSelectVideo={(id) => {
          setSelectedVideoId(id);
          setTab("mentions");
        }}
      />
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
