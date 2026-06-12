"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip,
  ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { PerformanceRangeResponse, SeriesPoint } from "@/lib/types";

const CHART_RANGES = ["1m", "3m", "6m", "ytd", "1y"] as const;
type ChartRange = (typeof CHART_RANGES)[number];
const RANGE_LABEL: Record<ChartRange, string> = {
  "1m": "1M", "3m": "3M", "6m": "6M", ytd: "YTD", "1y": "1Y",
};

function merge(
  portfolio: SeriesPoint[] | null,
  voo: SeriesPoint[] | null,
  qqq: SeriesPoint[] | null,
): Record<string, number | string>[] {
  const rows = new Map<string, Record<string, number | string>>();
  const put = (key: "portfolio" | "voo" | "qqq", points: SeriesPoint[] | null) => {
    for (const p of points ?? []) {
      const row = rows.get(p.date) ?? { date: p.date };
      row[key] = p.value;
      rows.set(p.date, row);
    }
  };
  put("portfolio", portfolio);
  put("voo", voo);
  put("qqq", qqq);
  return [...rows.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
}

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
    ? merge(data.portfolio?.series ?? null, data.voo.series, data.qqq.series)
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
              <YAxis domain={["auto", "auto"]} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
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
