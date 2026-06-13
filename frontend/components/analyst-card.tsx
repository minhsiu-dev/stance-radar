"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalystData } from "@/lib/types";
import { cn } from "@/lib/utils";

const SEGMENTS = [
  { key: "strongBuy", color: "bg-sky-600" },
  { key: "buy", color: "bg-sky-400" },
  { key: "hold", color: "bg-zinc-400" },
  { key: "sell", color: "bg-orange-400" },
  { key: "strongSell", color: "bg-orange-600" },
] as const;

export function AnalystCard({
  data,
  price,
}: {
  data: AnalystData;
  price: number | null;
}) {
  const t = useTranslations("Stock.analyst");
  if (data.target_mean == null) return null;
  const upside =
    price != null && price !== 0
      ? (data.target_mean / price - 1) * 100
      : null;
  const total = Object.values(data.recommendations).reduce((a, b) => a + b, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("title")}
          {data.analyst_count != null && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {t("count", { count: data.analyst_count })}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">{t("low")}</span>
          <span className="font-mono tabular-nums">{data.target_low ?? "—"}</span>
          <span className="text-muted-foreground">{t("mean")}</span>
          <span className="font-mono text-base font-semibold tabular-nums">
            {data.target_mean}
          </span>
          <span className="text-muted-foreground">{t("high")}</span>
          <span className="font-mono tabular-nums">{data.target_high ?? "—"}</span>
        </div>
        {upside != null && (
          <p className="text-sm">
            {t("upside")}{" "}
            <span
              className={cn(
                "font-mono font-medium tabular-nums",
                upside >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400",
              )}
            >
              {upside >= 0 ? "+" : ""}
              {upside.toFixed(1)}%
            </span>
          </p>
        )}
        {total > 0 && (
          <div className="space-y-1">
            <div
              data-testid="rating-bar"
              className="flex h-2.5 overflow-hidden rounded"
            >
              {SEGMENTS.map((s) => {
                const n = data.recommendations[s.key] ?? 0;
                if (n === 0) return null;
                return (
                  <div
                    key={s.key}
                    className={s.color}
                    style={{ width: `${(n / total) * 100}%` }}
                    title={`${t(s.key)}: ${n}`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              {SEGMENTS.map((s) => (
                <span key={s.key}>
                  {t(s.key)} {data.recommendations[s.key] ?? 0}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
