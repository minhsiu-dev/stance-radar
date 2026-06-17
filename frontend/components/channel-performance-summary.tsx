"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { alphaColor } from "@/components/channel-leaderboard";
import { formatSignedPct, formatWinRate } from "@/lib/format";
import type { ChannelPerformanceDto, PerfFilter } from "@/lib/types";

export function ChannelPerformanceSummary({ channelId }: { channelId: string }) {
  const t = useTranslations("ChannelDetail.performance");
  const tCol = useTranslations("Scorecard.columns");
  const tStance = useTranslations("Stock.stance");
  const [filter, setFilter] = useState<PerfFilter>("buy");

  const { data, error } = useSWR<ChannelPerformanceDto>(
    `/api/channels/${channelId}/performance`,
  );

  const rows: { key: "now" | "30" | "90"; label: string }[] = [
    { key: "now", label: tCol("now") },
    { key: "30", label: tCol("horizon", { days: 30 }) },
    { key: "90", label: tCol("horizon", { days: 90 }) },
  ];
  const filters: { key: PerfFilter; label: string }[] = [
    { key: "all", label: t("filter.all") },
    { key: "buy", label: tStance("buy") },
    { key: "sell", label: tStance("sell") },
  ];

  return (
    <Card data-testid="channel-performance">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-y-2 space-y-0">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <div className="flex gap-1">
          {filters.map((f) => (
            <Button
              key={f.key}
              type="button"
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-muted-foreground">{t("error")}</p>
        ) : !data ? (
          <Skeleton className="h-32 w-full" />
        ) : data.counts[filter] === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3">{t("columns.period")}</th>
                  <th className="py-1.5 pr-3 text-right">{t("columns.winRate")}</th>
                  <th className="py-1.5 pr-3 text-right">{t("columns.avgReturn")}</th>
                  <th className="py-1.5 pr-3 text-right">{t("columns.medianReturn")}</th>
                  <th className="py-1.5 pr-3 text-right">{t("columns.avg")}</th>
                  <th className="py-1.5 pr-3 text-right">{t("columns.median")}</th>
                  <th className="py-1.5 text-right">{t("columns.samples")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cell = data.summary[filter][r.key];
                  return (
                    <tr key={r.key} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{r.label}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatWinRate(cell.win_rate)}
                      </td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums", alphaColor(cell.avg_return))}>
                        {formatSignedPct(cell.avg_return)}
                      </td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums", alphaColor(cell.median_return))}>
                        {formatSignedPct(cell.median_return)}
                      </td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums", alphaColor(cell.avg))}>
                        {formatSignedPct(cell.avg)}
                      </td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums", alphaColor(cell.median))}>
                        {formatSignedPct(cell.median)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {cell.n}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
