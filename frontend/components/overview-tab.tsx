"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { formatMarketCap } from "@/lib/format";
import type {
  FinancialReport,
  StanceSummary,
  StockSummary,
} from "@/lib/types";
import { cn } from "@/lib/utils";

function yoy(latest: number | null, prior: number | null): number | null {
  if (latest == null || prior == null || prior === 0) return null;
  return (latest - prior) / prior;
}

export function OverviewTab({ ticker }: { ticker: string }) {
  const t = useTranslations("Stock.overview");
  const { data: financials } = useSWR<FinancialReport[]>(
    `/api/stocks/${ticker}/financials?period=quarterly`,
    apiFetch,
  );
  const { data: summary } = useSWR<StanceSummary>(
    `/api/stocks/${ticker}/stance-summary`,
    apiFetch,
  );
  const { data: stock } = useSWR<StockSummary>(
    `/api/stocks/${ticker}`,
    apiFetch,
  );

  if (!financials || !summary || !stock)
    return <Skeleton className="h-48 w-full" />;

  const latest = financials.at(-1);
  const prior = financials.length >= 5 ? financials.at(-5) : undefined;
  const maxStance = Math.max(summary.buy, summary.neutral, summary.sell, 1);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("latestQuarter")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row
            label={t("revenue")}
            latest={latest?.total_revenue ?? null}
            prior={prior?.total_revenue ?? null}
            format={formatMarketCap}
          />
          <Row
            label={t("netIncome")}
            latest={latest?.net_income ?? null}
            prior={prior?.net_income ?? null}
            format={formatMarketCap}
          />
          <Row
            label={t("eps")}
            latest={stock.eps}
            prior={null}
            format={(v) => (v == null ? "—" : v.toFixed(2))}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("ytStance", { days: summary.window_days })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Bar label="Buy" count={summary.buy} max={maxStance} color="bg-sky-500" />
          <Bar label="Neutral" count={summary.neutral} max={maxStance} color="bg-zinc-400" />
          <Bar label="Sell" count={summary.sell} max={maxStance} color="bg-orange-500" />
        </CardContent>
      </Card>
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
