"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { masked, usePrivacy } from "@/components/privacy-provider";
import { Sparkline } from "@/components/sparkline";
import type { PerfChanges, PerformanceSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const CHIP_RANGES = ["5d", "1m", "3m", "6m", "ytd", "1y"] as const;
const RANGE_LABEL: Record<(typeof CHIP_RANGES)[number], string> = {
  "5d": "5D", "1m": "1M", "3m": "3M", "6m": "6M", ytd: "YTD", "1y": "1Y",
};

function pctText(v: number | null | undefined): string {
  if (v == null) return "—";
  const rounded = Math.round(v * 10) / 10 + 0; // 避免 -0.04 顯示成 "-0.0%"
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
  hide,
  ticker,
}: {
  title: string;
  headline: string;
  changes: PerfChanges;
  hide: boolean;
  ticker?: string;
}) {
  return (
    <Card data-testid="perf-card">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">{title}</span>
          <span className="font-mono text-sm tabular-nums">{headline}</span>
        </div>
        {ticker && <Sparkline ticker={ticker} />}
        <div className="flex items-baseline gap-2">
          <span className={cn("text-2xl font-semibold", pctClass(changes["1d"]))}>
            {masked(hide, pctText(changes["1d"]))}
          </span>
          <span className="text-xs text-muted-foreground">1D</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {CHIP_RANGES.map((r) => (
            <span key={r} className="inline-flex items-baseline gap-1">
              <span className="text-muted-foreground">{RANGE_LABEL[r]}</span>
              <span className={cn("font-mono tabular-nums", pctClass(changes[r]))}>
                {masked(hide, pctText(changes[r]))}
              </span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function PerformanceCards() {
  const t = useTranslations("Dashboard.performance");
  const { hideAmounts } = usePrivacy();
  const { data, error } = useSWR<PerformanceSummary>(
    "/api/portfolio/performance/summary",
  );

  if (error) {
    return (
      <p className="text-sm text-red-500">
        {t("loadError", { message: error.message })}
      </p>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {data.portfolio ? (
        <PerfCard
          title={t("portfolio")}
          headline={masked(hideAmounts, money(data.portfolio.total_value))}
          changes={data.portfolio.changes}
          hide={hideAmounts}
        />
      ) : (
        <Card>
          <CardContent className="flex h-full flex-col items-start justify-center gap-1 p-4">
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
            <Link href="/portfolio" className="text-sm underline">
              {t("emptyCta")}
            </Link>
          </CardContent>
        </Card>
      )}
      <PerfCard title="VOO" headline={money(data.voo.price)} changes={data.voo.changes} hide={false} ticker="VOO" />
      <PerfCard title="QQQ" headline={money(data.qqq.price)} changes={data.qqq.changes} hide={false} ticker="QQQ" />
    </div>
  );
}
