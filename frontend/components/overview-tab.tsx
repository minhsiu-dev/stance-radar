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
import { formatMarketCap } from "@/lib/format";
import type {
  AnalystData,
  FinancialReport,
  StanceSummary,
  StockSummary,
} from "@/lib/types";
import { AnalystCard } from "@/components/analyst-card";
import { FinancialsChart } from "@/components/financials-chart";
import { GrowthMargins } from "@/components/growth-margins";
import { cn } from "@/lib/utils";

const WINDOW_OPTIONS = [30, 90, 180, 365] as const;
const ALL_WINDOW = 3650;

function yoy(latest: number | null, prior: number | null): number | null {
  if (latest == null || prior == null || prior === 0) return null;
  return (latest - prior) / prior;
}

export function OverviewTab({ ticker }: { ticker: string }) {
  const t = useTranslations("Stock.overview");
  const tErr = useTranslations("Errors");
  const tStance = useTranslations("Stock.stance");
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

  const latest = financials.at(-1);
  const prior = financials.length >= 5 ? financials.at(-5) : undefined;
  const maxStance = Math.max(summary.buy, summary.neutral, summary.sell, 1);

  const stanceTitleKey = windowDays === ALL_WINDOW ? "ytStanceAll" : "ytStance";
  const stanceTitleArgs = windowDays === ALL_WINDOW ? undefined : { days: windowDays };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
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
          <CardContent className="space-y-2">
            <Bar label={tStance("buy")} count={summary.buy} max={maxStance} color="bg-sky-500" />
            <Bar label={tStance("neutral")} count={summary.neutral} max={maxStance} color="bg-zinc-400" />
            <Bar label={tStance("sell")} count={summary.sell} max={maxStance} color="bg-orange-500" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("latestQuarter")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label={t("revenue")} latest={latest?.total_revenue ?? null} prior={prior?.total_revenue ?? null} format={formatMarketCap} />
            <Row label={t("netIncome")} latest={latest?.net_income ?? null} prior={prior?.net_income ?? null} format={formatMarketCap} />
            <Row label={t("eps")} latest={stock.eps} prior={null} format={(v) => (v == null ? "—" : v.toFixed(2))} />
          </CardContent>
        </Card>
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
        <GrowthMargins reports={financials} />
        {analyst && <AnalystCard data={analyst} price={stock.price} />}
      </div>
    </div>
  );
}

function Row({
  label,
  latest,
  prior,
  format,
}: {
  label: string;
  latest: number | null;
  prior: number | null;
  format: (v: number | null) => string;
}) {
  const change = yoy(latest, prior);
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{format(latest)}</span>
        {change != null && (
          <span
            className={cn(
              "text-xs",
              change >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            {change >= 0 ? "▲" : "▼"} {(change * 100).toFixed(1)}%
          </span>
        )}
        {change == null && (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

function Bar({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
}) {
  const pct = (count / max) * 100;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-16 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
        <div className={cn("h-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono">{count}</span>
    </div>
  );
}
