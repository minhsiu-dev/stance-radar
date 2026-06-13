"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import type { TrendingStock } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TrendingStocks({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (ticker: string | null) => void;
}) {
  const t = useTranslations("Dashboard.trending");
  const { data, isLoading } = useSWR<TrendingStock[]>(
    "/api/stocks/trending?limit=12",
  );

  if (isLoading) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </h2>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 shrink-0 rounded-full" />
          ))}
        </div>
      </section>
    );
  }

  if (!data || data.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {t("title")}
      </h2>
      {/* py/-my + px/-mx:給 hover 的位移與陰影留空間,否則會被 overflow 容器切掉 */}
      <div className="-mx-1 -my-2 flex gap-2 overflow-x-auto px-1 py-2">
        {data.map((s) => {
          const isActive = selected === s.ticker;
          return (
            <button
              key={s.ticker}
              type="button"
              data-testid="trending-pill"
              aria-pressed={isActive}
              onClick={() => onSelect(isActive ? null : s.ticker)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-all hover:-translate-y-px hover:border-foreground/40 hover:bg-accent hover:shadow-sm",
                isActive && "border-primary bg-primary/10",
                selected !== null && !isActive && "opacity-40",
              )}
            >
              <span className="font-mono font-semibold tracking-tight">
                {s.ticker}
              </span>
              <span className="tabular-nums text-xs font-medium text-muted-foreground">
                {s.mention_count}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
