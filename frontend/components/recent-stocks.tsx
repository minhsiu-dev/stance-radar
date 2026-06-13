"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TrendingStock } from "@/lib/types";

const PERIODS = [
  { days: 7, key: "week" },
  { days: 30, key: "month" },
  { days: 90, key: "quarter" },
] as const;

const WIDEST_DAYS = 90;

export function RecentStocks() {
  const t = useTranslations("Dashboard.recentStocks");
  const [days, setDays] = useState<number>(WIDEST_DAYS);
  const { data, isLoading } = useSWR<TrendingStock[]>(
    `/api/stocks/trending?limit=12&days=${days}`,
  );

  // 最寬的視窗(3M)都沒有資料 → 視為尚無討論,整段不顯示
  if (!isLoading && days === WIDEST_DAYS && (!data || data.length === 0)) {
    return null;
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {t("title")}
        </h2>
        <div className="flex gap-1" role="group" aria-label={t("title")}>
          {PERIODS.map((p) => {
            const active = days === p.days;
            return (
              <button
                key={p.days}
                type="button"
                aria-pressed={active}
                onClick={() => setDays(p.days)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent",
                )}
              >
                {t(p.key)}
              </button>
            );
          })}
        </div>
      </div>
      {isLoading ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 shrink-0 rounded-full" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        // 換行排列,最多兩行(max-h ≈ 2 列 pill 高 + 列距),其餘裁掉
        <div className="flex max-h-[5rem] flex-wrap gap-2 overflow-hidden">
          {data.map((s) => (
            <Link
              key={s.ticker}
              href={`/stocks/${s.ticker}`}
              data-testid="recent-stock-pill"
              className="flex shrink-0 items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:border-foreground/40 hover:bg-accent hover:shadow-sm"
            >
              <span className="font-mono font-semibold tracking-tight">{s.ticker}</span>
              <span className="tabular-nums text-xs font-medium text-muted-foreground">
                {s.mention_count}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </section>
  );
}
