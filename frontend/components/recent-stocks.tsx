"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StockCard } from "@/components/stock-card";
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
    `/api/stocks/trending?limit=6&days=${days}`,
  );

  // No data even in the widest window (3M) → treat as no discussion yet and hide the whole section
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
        <Link href="/stocks" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {t("viewAll")}
        </Link>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => (
            <StockCard key={s.ticker} s={s} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </section>
  );
}
