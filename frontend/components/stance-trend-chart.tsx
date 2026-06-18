"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, XAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StanceBucket } from "@/lib/types";

// Pinned to the StanceMiniBar palette: sky-500 / zinc-400 / orange-500.
const COLORS = { buy: "#0ea5e9", neutral: "#a1a1aa", sell: "#f97316" } as const;

export function StanceTrendChart({
  buckets,
  className,
}: {
  buckets: StanceBucket[];
  className?: string;
}) {
  const t = useTranslations("Stock.stance");
  const total = buckets.reduce((sum, b) => sum + b.buy + b.neutral + b.sell, 0);
  if (total === 0) return null;

  const config: ChartConfig = {
    buy: { label: t("buy"), color: COLORS.buy },
    neutral: { label: t("neutral"), color: COLORS.neutral },
    sell: { label: t("sell"), color: COLORS.sell },
  };

  return (
    <ChartContainer config={config} className={cn("h-16 w-full", className)}>
      <BarChart data={buckets} barCategoryGap={2} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
        <XAxis dataKey="start" hide />
        <ChartTooltip
          content={
            <ChartTooltipContent labelFormatter={(value) => formatDate(String(value))} />
          }
        />
        <Bar dataKey="buy" stackId="a" fill="var(--color-buy)" />
        <Bar dataKey="neutral" stackId="a" fill="var(--color-neutral)" />
        <Bar dataKey="sell" stackId="a" fill="var(--color-sell)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
