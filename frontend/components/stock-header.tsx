"use client";

import useSWR from "swr";
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
  const { data, error, isLoading } = useSWR<StockSummary>(
    `/api/stocks/${ticker}`,
    apiFetch,
  );

  if (isLoading) return <Skeleton className="h-28 w-full" />;
  if (error) {
    return <p className="text-sm text-red-500">行情讀取失敗:{error.message}</p>;
  }
  if (!data) return null;

  const up = (data.change ?? 0) >= 0;
  const stats: [string, string][] = [
    ["市值", formatMarketCap(data.market_cap)],
    ["本益比 (TTM)", formatNumber(data.pe_ratio)],
    ["EPS (TTM)", formatNumber(data.eps)],
    [
      "52 週區間",
      `${formatNumber(data.week52_low)} – ${formatNumber(data.week52_high)}`,
    ],
    ["成交量", formatVolume(data.volume)],
    [
      "殖利率",
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
        <span className={cn("text-sm", up ? "text-green-500" : "text-red-500")}>
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
