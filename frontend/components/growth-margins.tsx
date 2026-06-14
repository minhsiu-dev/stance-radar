"use client";

import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip,
  ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { formatMarketCap } from "@/lib/format";
import type { FinancialReport } from "@/lib/types";
import { cn } from "@/lib/utils";

const METRICS = [
  { key: "total_revenue", label: "revenue" },
  { key: "gross_profit", label: "grossProfit" },
  { key: "operating_income", label: "operatingIncome" },
  { key: "net_income", label: "netIncome" },
] as const;

function growth(curr: number | null, prior: number | null): number | null {
  if (curr == null || prior == null || prior === 0) return null;
  return (curr / prior - 1) * 100;
}

function pct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function pctClass(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  return v >= 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
}

function margin(profit: number | null, revenue: number | null): number | null {
  if (profit == null || revenue == null || revenue === 0) return null;
  return (profit / revenue) * 100;
}

export function GrowthTable({ reports }: { reports: FinancialReport[] }) {
  const t = useTranslations("Stock.growth");
  if (reports.length === 0) return null;
  const latest = reports.at(-1)!;
  const prev = reports.length >= 2 ? reports.at(-2)! : null;
  const yearAgo = reports.length >= 5 ? reports.at(-5)! : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2">{t("metric")}</th>
              <th className="py-1.5 pr-2 text-right">{t("value")}</th>
              <th className="py-1.5 pr-2 text-right">{t("qoq")}</th>
              <th className="py-1.5 text-right">{t("yoy")}</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const curr = latest[m.key];
              const qoq = growth(curr, prev?.[m.key] ?? null);
              const yoy = growth(curr, yearAgo?.[m.key] ?? null);
              return (
                <tr key={m.key} className="border-b last:border-0">
                  <td className="py-1.5 pr-2 text-muted-foreground">
                    {t(m.label)}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                    {formatMarketCap(curr)}
                  </td>
                  <td className={cn("py-1.5 pr-2 text-right font-mono tabular-nums", pctClass(qoq))}>
                    {pct(qoq)}
                  </td>
                  <td className={cn("py-1.5 text-right font-mono tabular-nums", pctClass(yoy))}>
                    {pct(yoy)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function MarginsChart({ reports }: { reports: FinancialReport[] }) {
  const t = useTranslations("Stock.growth");
  if (reports.length === 0) return null;

  const marginRows = reports.slice(-8).map((r) => ({
    period: r.period_end,
    gross: margin(r.gross_profit, r.total_revenue),
    operating: margin(r.operating_income, r.total_revenue),
    net: margin(r.net_income, r.total_revenue),
  }));
  const config: ChartConfig = {
    gross: { label: t("grossMargin"), color: "var(--chart-1)" },
    operating: { label: t("operatingMargin"), color: "var(--chart-2)" },
    net: { label: t("netMargin"), color: "var(--chart-3)" },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("marginsTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-48 w-full">
          <LineChart data={marginRows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period" minTickGap={32} />
            <YAxis
              width={40}
              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(v) => `${Number(v).toFixed(1)}%`}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Line dataKey="gross" stroke="var(--color-gross)" dot={false} />
            <Line dataKey="operating" stroke="var(--color-operating)" dot={false} />
            <Line dataKey="net" stroke="var(--color-net)" dot={false} />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/** 舊組合(成長表 + 利潤率圖);保留給既有測試 / 其他可能引用點。 */
export function GrowthMargins({ reports }: { reports: FinancialReport[] }) {
  if (reports.length === 0) return null;
  return (
    <>
      <GrowthTable reports={reports} />
      <MarginsChart reports={reports} />
    </>
  );
}
