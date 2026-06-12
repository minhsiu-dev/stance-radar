"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
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

const FinancialsTab = dynamic(
  () => import("@/components/financials-tab").then((m) => m.FinancialsTab),
  { ssr: false },
);

export function StockView({ ticker }: { ticker: string }) {
  const t = useTranslations("Stock.tabs");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      <StockHeader ticker={ticker} />
      <PriceChart
        ticker={ticker}
        hoveredVideoId={hoveredVideoId}
        onSelectVideo={setSelectedVideoId}
      />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("overview")}</TabsTrigger>
          <TabsTrigger value="mentions">{t("mentions")}</TabsTrigger>
          <TabsTrigger value="financials">{t("financials")}</TabsTrigger>
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
        <TabsContent value="financials">
          <FinancialsTab ticker={ticker} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
