"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { HoldingsResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function Stat({
  label, value, valueClass,
}: { label: string; value: string; valueClass?: string }) {
  return (
    <Card className="bg-card/50">
      <CardContent className="p-4">
        <p className={cn("font-mono text-xl font-semibold tabular-nums", valueClass)}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

export function PortfolioSummary() {
  const t = useTranslations("Portfolio.totals");
  const { data } = useSWR<HoldingsResponse>("/api/portfolio/holdings");

  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }
  const { totals } = data;
  const plPositive = (totals.unrealized_pl ?? 0) >= 0;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label={t("marketValue")} value={money(totals.market_value)} />
      <Stat label={t("costBasis")} value={money(totals.cost_basis)} />
      <Stat
        label={t("unrealizedPl")}
        value={
          totals.unrealized_pl == null
            ? "—"
            : totals.unrealized_pl_percent == null
              ? money(totals.unrealized_pl)
              : `${money(totals.unrealized_pl)} (${plPositive ? "+" : ""}${totals.unrealized_pl_percent.toFixed(1)}%)`
        }
        valueClass={cn(
          totals.unrealized_pl != null &&
            (plPositive
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"),
        )}
      />
    </div>
  );
}
