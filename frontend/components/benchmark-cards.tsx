"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/sparkline";
import type { BenchmarksResponse, PerfChanges } from "@/lib/types";
import { cn } from "@/lib/utils";

const CHIP_RANGES = ["5d", "1m", "3m", "6m", "ytd", "1y"] as const;
const RANGE_LABEL: Record<(typeof CHIP_RANGES)[number], string> = {
  "5d": "5D", "1m": "1M", "3m": "3M", "6m": "6M", ytd: "YTD", "1y": "1Y",
};

function pctText(v: number | null | undefined): string {
  if (v == null) return "—";
  const rounded = Math.round(v * 10) / 10 + 0; // avoid -0.04 rendering as "-0.0%"
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function pctClass(v: number | null | undefined): string {
  if (v == null) return "text-muted-foreground";
  return Math.round(v * 10) / 10 + 0 >= 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
}

function money(v: number | null): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function PerfCard({
  title,
  headline,
  changes,
  ticker,
}: {
  title: string;
  headline: string;
  changes: PerfChanges;
  ticker: string;
}) {
  return (
    <Card data-testid="perf-card">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">{title}</span>
          <span className="font-mono text-sm tabular-nums">{headline}</span>
        </div>
        <Sparkline ticker={ticker} />
        <div className="flex items-baseline gap-2">
          <span className={cn("text-2xl font-semibold", pctClass(changes["1d"]))}>
            {pctText(changes["1d"])}
          </span>
          <span className="text-xs text-muted-foreground">1D</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {CHIP_RANGES.map((r) => (
            <span key={r} className="inline-flex items-baseline gap-1">
              <span className="text-muted-foreground">{RANGE_LABEL[r]}</span>
              <span className={cn("font-mono tabular-nums", pctClass(changes[r]))}>
                {pctText(changes[r])}
              </span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function BenchmarkCards() {
  const t = useTranslations("Dashboard.benchmarks");
  const { data, error } = useSWR<BenchmarksResponse>("/api/markets/benchmarks");

  if (error) {
    return (
      <p className="text-sm text-red-500">
        {t("loadError", { message: error.message })}
      </p>
    );
  }
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {t("title")}
      </h2>
      {!data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {data.items.map((item) => (
            <PerfCard
              key={item.ticker}
              title={item.ticker}
              headline={money(item.price)}
              changes={item.changes}
              ticker={item.ticker}
            />
          ))}
        </div>
      )}
    </section>
  );
}
