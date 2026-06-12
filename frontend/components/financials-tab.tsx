"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import type { FinancialReport, FinancialsPeriod } from "@/lib/types";

function compactUSD(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

export function FinancialsTab({ ticker }: { ticker: string }) {
  const t = useTranslations("Stock.financials");
  const tErr = useTranslations("Errors");
  const [period, setPeriod] = useState<FinancialsPeriod>("quarterly");
  const { data, isLoading, error } = useSWR<FinancialReport[]>(
    `/api/stocks/${ticker}/financials?period=${period}`,
    apiFetch,
  );

  const config: ChartConfig = {
    total_revenue: { label: t("totalRevenue"), color: "var(--chart-1)" },
    gross_profit: { label: t("grossProfit"), color: "var(--chart-2)" },
    operating_income: { label: t("operatingIncome"), color: "var(--chart-3)" },
    pretax_income: { label: t("pretaxIncome"), color: "var(--chart-4)" },
    net_income: { label: t("netIncome"), color: "var(--chart-5)" },
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-1">
        <Button
          size="sm"
          variant={period === "quarterly" ? "default" : "ghost"}
          onClick={() => setPeriod("quarterly")}
        >
          {t("quarterly")}
        </Button>
        <Button
          size="sm"
          variant={period === "annual" ? "default" : "ghost"}
          onClick={() => setPeriod("annual")}
        >
          {t("annual")}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-red-500">
          {tErr("financialsLoad", { message: (error as Error).message })}
        </p>
      )}
      {isLoading && <Skeleton className="h-80 w-full" />}
      {data && (
        <ChartContainer config={config} className="h-80 w-full">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period_end" />
            <YAxis tickFormatter={(v) => compactUSD(Number(v))} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(v) => compactUSD(Number(v))}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="total_revenue" fill="var(--color-total_revenue)" />
            <Bar dataKey="gross_profit" fill="var(--color-gross_profit)" />
            <Bar
              dataKey="operating_income"
              fill="var(--color-operating_income)"
            />
            <Bar dataKey="pretax_income" fill="var(--color-pretax_income)" />
            <Bar dataKey="net_income" fill="var(--color-net_income)" />
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
