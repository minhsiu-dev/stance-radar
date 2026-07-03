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
// "repeat" (same-stance restatement) segments use the same color, dimmed.
// Opacity reads as "faded" in both light and dark themes; a lighter tint would
// look *brighter* in dark mode, inverting the meaning.
const REPEAT_OPACITY = 0.4;

export function StanceTrendChart({
  buckets,
  className,
}: {
  buckets: StanceBucket[];
  className?: string;
}) {
  const t = useTranslations("Stock.stance");
  const total = buckets.reduce(
    (sum, b) =>
      sum +
      b.buy_new + b.buy_repeat +
      b.neutral_new + b.neutral_repeat +
      b.sell_new + b.sell_repeat,
    0,
  );
  if (total === 0) return null;

  const config: ChartConfig = {
    buy_new: { label: `${t("buy")} · ${t("new")}`, color: COLORS.buy },
    buy_repeat: { label: `${t("buy")} · ${t("repeat")}`, color: COLORS.buy },
    neutral_new: { label: `${t("neutral")} · ${t("new")}`, color: COLORS.neutral },
    neutral_repeat: { label: `${t("neutral")} · ${t("repeat")}`, color: COLORS.neutral },
    sell_new: { label: `${t("sell")} · ${t("new")}`, color: COLORS.sell },
    sell_repeat: { label: `${t("sell")} · ${t("repeat")}`, color: COLORS.sell },
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
        <Bar dataKey="buy_new" stackId="a" fill="var(--color-buy_new)" />
        <Bar dataKey="buy_repeat" stackId="a" fill="var(--color-buy_repeat)" fillOpacity={REPEAT_OPACITY} />
        <Bar dataKey="neutral_new" stackId="a" fill="var(--color-neutral_new)" />
        <Bar dataKey="neutral_repeat" stackId="a" fill="var(--color-neutral_repeat)" fillOpacity={REPEAT_OPACITY} />
        <Bar dataKey="sell_new" stackId="a" fill="var(--color-sell_new)" />
        <Bar dataKey="sell_repeat" stackId="a" fill="var(--color-sell_repeat)" radius={[2, 2, 0, 0]} fillOpacity={REPEAT_OPACITY} />
      </BarChart>
    </ChartContainer>
  );
}
