"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDate } from "@/lib/format";
import { bucketTotal } from "@/lib/stance-buckets";
import { cn } from "@/lib/utils";
import type { SparklinePoint, StanceBucket } from "@/lib/types";

// Pinned to the StanceMiniBar palette: sky-500 / zinc-400 / orange-500.
const COLORS = { buy: "#0ea5e9", neutral: "#a1a1aa", sell: "#f97316" } as const;
// "repeat" (same-stance restatement) segments use the same color, dimmed.
// Opacity reads as "faded" in both light and dark themes; a lighter tint would
// look *brighter* in dark mode, inverting the meaning.
const REPEAT_OPACITY = 0.4;

// Price overlay geometry (viewBox units; rendered with preserveAspectRatio="none").
const OVERLAY_W = 100;
const OVERLAY_H = 32;
const OVERLAY_PAD = 3; // keep peak/trough strokes off the edges (no clipping)
const DAY_MS = 86_400_000;
// Direction colors shared with the benchmark Sparkline component.
const UP_COLOR = "#10b981";
const DOWN_COLOR = "#ef4444";

// Map daily closes onto the bucket timeline. x = the close's end-of-day
// position within [buckets[0].start, last bucket end] — linear calendar time,
// which matches recharts' equal-width band slots because buckets are
// equal-length calendar spans. y = min-max normalized. Closes are clipped to
// the bucket window: the backend fetches nominal `days`, but n buckets only
// cover n*size days (a 30d window is 4 weekly buckets = 28 days), so
// out-of-window points would otherwise shift the whole line; the trailing
// close (today, still inside the last bucket) clamps to the right edge.
export function overlayPoints(
  buckets: StanceBucket[],
  closes: SparklinePoint[],
): { points: string; up: boolean } | null {
  if (buckets.length === 0) return null;
  const start = Date.parse(buckets[0].start);
  const end = Date.parse(buckets[buckets.length - 1].end);
  if (!(end > start)) return null;
  const pts = closes
    .map((p) => ({ t: Date.parse(p.date) + DAY_MS, close: p.close }))
    .filter((p) => Number.isFinite(p.t) && p.t > start)
    .map((p) => ({ t: Math.min(p.t, end), close: p.close }));
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.close));
  const hi = Math.max(...pts.map((p) => p.close));
  const span = hi - lo || 1;
  const points = pts
    .map((p) => {
      const x = ((p.t - start) / (end - start)) * OVERLAY_W;
      const y = OVERLAY_PAD + (1 - (p.close - lo) / span) * (OVERLAY_H - 2 * OVERLAY_PAD);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return { points, up: pts[pts.length - 1].close >= pts[0].close };
}

export function StanceTrendChart({
  buckets,
  yMax,
  closes,
  className,
}: {
  buckets: StanceBucket[];
  yMax?: number;
  closes?: SparklinePoint[];
  className?: string;
}) {
  const t = useTranslations("Stock.stance");
  const total = buckets.reduce((sum, b) => sum + bucketTotal(b), 0);
  if (total === 0) return null;

  const overlay = closes && closes.length > 0 ? overlayPoints(buckets, closes) : null;

  const config: ChartConfig = {
    buy_new: { label: `${t("buy")} · ${t("new")}`, color: COLORS.buy },
    buy_repeat: { label: `${t("buy")} · ${t("repeat")}`, color: COLORS.buy },
    neutral_new: { label: `${t("neutral")} · ${t("new")}`, color: COLORS.neutral },
    neutral_repeat: { label: `${t("neutral")} · ${t("repeat")}`, color: COLORS.neutral },
    sell_new: { label: `${t("sell")} · ${t("new")}`, color: COLORS.sell },
    sell_repeat: { label: `${t("sell")} · ${t("repeat")}`, color: COLORS.sell },
  };

  return (
    <div className={cn("relative h-16 w-full", className)}>
      <ChartContainer config={config} className="h-full w-full">
        <BarChart data={buckets} barCategoryGap={2} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
          <XAxis dataKey="start" hide />
          {yMax !== undefined && <YAxis hide domain={[0, yMax]} />}
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
      {overlay && (
        <svg
          viewBox={`0 0 ${OVERLAY_W} ${OVERLAY_H}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          <polyline
            data-testid="price-overlay-line"
            points={overlay.points}
            fill="none"
            stroke={overlay.up ? UP_COLOR : DOWN_COLOR}
            strokeWidth={1.5}
            strokeOpacity={0.8}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  );
}
