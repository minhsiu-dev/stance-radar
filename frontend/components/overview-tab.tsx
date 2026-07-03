"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import type {
  AnalystData,
  FinancialReport,
  StanceSummary,
  StockSummary,
} from "@/lib/types";
import { AnalystCard } from "@/components/analyst-card";
import { ChannelAvatar } from "@/components/channel-avatar";
import { FinancialsChart } from "@/components/financials-chart";
import { GrowthTable, MarginsChart } from "@/components/growth-margins";
import { StanceTrendChart } from "@/components/stance-trend-chart";
import { StanceMiniBar } from "@/components/stance-mini-bar";

const WINDOW_OPTIONS = [30, 90, 180, 365] as const;
const ALL_WINDOW = 3650;
const MAX_AVATARS = 10;

export function OverviewTab({ ticker }: { ticker: string }) {
  const t = useTranslations("Stock.overview");
  const tErr = useTranslations("Errors");
  const [windowDays, setWindowDays] = useState(90);

  const { data: financials, error: financialsError } = useSWR<FinancialReport[]>(
    `/api/stocks/${ticker}/financials?period=quarterly`,
    apiFetch,
  );
  const { data: summary, error: summaryError } = useSWR<StanceSummary>(
    `/api/stocks/${ticker}/stance-summary?days=${windowDays}`,
    apiFetch,
  );
  const { data: stock, error: stockError } = useSWR<StockSummary>(
    `/api/stocks/${ticker}`,
    apiFetch,
  );
  const { data: analyst } = useSWR<AnalystData>(
    `/api/stocks/${ticker}/analyst`,
    apiFetch,
  );

  if (financialsError) {
    return <p className="text-sm text-red-500">{tErr("financialsLoad", { message: financialsError.message })}</p>;
  }
  if (summaryError) {
    return <p className="text-sm text-red-500">{tErr("summaryLoad", { message: summaryError.message })}</p>;
  }
  if (stockError) {
    return <p className="text-sm text-red-500">{tErr("priceLoad", { message: stockError.message })}</p>;
  }
  if (!financials || !summary || !stock)
    return <Skeleton className="h-48 w-full" />;

  const channels = summary.channels ?? [];
  const shownAvatars = channels.slice(0, MAX_AVATARS);
  const extraAvatars = channels.length - shownAvatars.length;

  // Aggregate proportional bar (the "summary over this interval") + the time-resolved
  // trend chart, mirroring how the Trending cards present a stock.
  const buckets = summary.buckets ?? [];
  const aggTotal = summary.buy + summary.neutral + summary.sell;
  const bucketTotal = buckets.reduce(
    (n, b) =>
      n +
      b.buy_new + b.buy_repeat +
      b.neutral_new + b.neutral_repeat +
      b.sell_new + b.sell_repeat,
    0,
  );
  const hasStance = aggTotal + bucketTotal > 0;
  const aggStances = {
    buy: { count: summary.buy, avatars: [] },
    neutral: { count: summary.neutral, avatars: [] },
    sell: { count: summary.sell, avatars: [] },
  };

  const stanceTitleKey = windowDays === ALL_WINDOW ? "ytStanceAll" : "ytStance";
  const stanceTitleArgs = windowDays === ALL_WINDOW ? undefined : { days: windowDays };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
        <Card className="flex flex-col">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-y-1 space-y-0">
            <CardTitle>
              {stanceTitleArgs ? t(stanceTitleKey, stanceTitleArgs) : t(stanceTitleKey)}
            </CardTitle>
            <div className="flex gap-1">
              {WINDOW_OPTIONS.map((days) => (
                <Button key={days} size="sm" variant={windowDays === days ? "default" : "ghost"} onClick={() => setWindowDays(days)}>
                  {days}
                </Button>
              ))}
              <Button size="sm" variant={windowDays === ALL_WINDOW ? "default" : "ghost"} onClick={() => setWindowDays(ALL_WINDOW)}>
                {t("windowAll")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            {hasStance ? (
              <div className="space-y-3">
                <StanceMiniBar stances={aggStances} />
                <StanceTrendChart buckets={buckets} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("stanceTrendEmpty")}</p>
            )}
            {shownAvatars.length > 0 && (
              <div className="mt-auto flex items-center gap-2 border-t pt-3">
                <span className="text-xs text-muted-foreground">
                  {t("channelsLabel", { count: channels.length })}
                </span>
                <div className="flex -space-x-1.5">
                  {shownAvatars.map((c) => (
                    <span key={c.id} className="rounded-full ring-2 ring-background">
                      <ChannelAvatar title={c.title} thumbnail={c.thumbnail_url ?? ""} />
                    </span>
                  ))}
                </div>
                {extraAvatars > 0 && (
                  <span className="text-xs text-muted-foreground">+{extraAvatars}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <GrowthTable reports={financials} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("financialsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FinancialsChart ticker={ticker} />
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <MarginsChart reports={financials} />
        {analyst && <AnalystCard data={analyst} price={stock.price} />}
      </div>
    </div>
  );
}

