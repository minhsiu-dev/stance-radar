"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip,
  ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { PerformanceRangeResponse } from "@/lib/types";
import { mergePerformance } from "@/lib/portfolio";

const CHART_RANGES = ["1m", "3m", "6m", "ytd", "1y"] as const;
type ChartRange = (typeof CHART_RANGES)[number];
const RANGE_LABEL: Record<ChartRange, string> = {
  "1m": "1M", "3m": "3M", "6m": "6M", ytd: "YTD", "1y": "1Y",
};


export function PortfolioChart() {
  const t = useTranslations("Portfolio.chart");
  const tErr = useTranslations("Errors");
  const [range, setRange] = useState<ChartRange>("1m");
  const { data, error, isLoading } = useSWR<PerformanceRangeResponse>(
    `/api/portfolio/performance?range=${range}`,
  );

  const config: ChartConfig = {
    portfolio: { label: t("portfolioSeries"), color: "var(--chart-1)" },
    voo: { label: "VOO", color: "var(--chart-2)" },
    qqq: { label: "QQQ", color: "var(--chart-3)" },
  };
  const rows = data
    ? mergePerformance(data.portfolio?.series ?? null, data.voo.series, data.qqq.series)
    : [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-y-2 space-y-0">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <div className="flex gap-1">
          {CHART_RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? "default" : "ghost"}
              onClick={() => setRange(r)}
            >
              {RANGE_LABEL[r]}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-red-500">
            {tErr("performanceLoad", { message: (error as Error).message })}
          </p>
        )}
        {isLoading && <Skeleton className="h-72 w-full" />}
        {data && rows.length > 0 && (
          <ChartContainer config={config} className="h-72 w-full">
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" minTickGap={32} />
              <YAxis
                domain={["auto", "auto"]}
                width={48}
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
              />
              <ReferenceLine y={0} stroke="var(--foreground)" strokeWidth={1.5} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name, item) => (
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: (item as { color?: string }).color }}
                          />
                          {config[name as keyof typeof config]?.label ?? name}
                        </span>
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {Number(value) > 0 ? "+" : ""}
                          {Number(value).toFixed(2)}%
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              {data.portfolio && (
                <Line dataKey="portfolio" stroke="var(--color-portfolio)" dot={false} />
              )}
              <Line dataKey="voo" stroke="var(--color-voo)" dot={false} />
              <Line dataKey="qqq" stroke="var(--color-qqq)" dot={false} />
            </LineChart>
          </ChartContainer>
        )}
        {data && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("noData")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
