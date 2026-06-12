"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import {
  formatMarketCap,
  formatNumber,
  formatPercent,
  formatVolume,
} from "@/lib/format";
import type { StockSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StockHeader({ ticker }: { ticker: string }) {
  const t = useTranslations("Stock.header");
  const { data, error, isLoading } = useSWR<StockSummary>(
    `/api/stocks/${ticker}`,
    apiFetch,
  );

  if (isLoading) return <Skeleton className="h-28 w-full" />;
  if (error) {
    return (
      <p className="text-sm text-red-500">
        {t("loadError", { message: error.message })}
      </p>
    );
  }
  if (!data) return null;

  const up = (data.change ?? 0) >= 0;
  const stats: [string, string][] = [
    [t("marketCap"), formatMarketCap(data.market_cap)],
    [t("peRatio"), formatNumber(data.pe_ratio)],
    [t("eps"), formatNumber(data.eps)],
    [
      t("week52Range"),
      `${formatNumber(data.week52_low)} – ${formatNumber(data.week52_high)}`,
    ],
    [t("volume"), formatVolume(data.volume)],
    [
      t("dividendYield"),
      data.dividend_yield == null ? "—" : `${formatNumber(data.dividend_yield)}%`,
    ],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{data.ticker}</h1>
        <span className="text-muted-foreground">{data.name}</span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-semibold">{formatNumber(data.price)}</span>
        <span
          className={cn(
            "text-sm",
            up
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400",
          )}
        >
          {up ? "+" : ""}
          {formatNumber(data.change)} ({formatPercent(data.change_percent)})
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
