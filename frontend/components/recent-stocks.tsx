"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import type { TrendingStock } from "@/lib/types";

export function RecentStocks() {
  const t = useTranslations("Dashboard.recentStocks");
  const { data, isLoading } = useSWR<TrendingStock[]>(
    "/api/stocks/trending?limit=12",
  );

  if (isLoading) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
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
        {data.map((s) => (
          <Link
            key={s.ticker}
            href={`/stocks/${s.ticker}`}
            data-testid="recent-stock-pill"
            className="flex shrink-0 items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-all hover:-translate-y-px hover:border-foreground/40 hover:bg-accent hover:shadow-sm"
          >
            <span className="font-mono font-semibold tracking-tight">{s.ticker}</span>
            <span className="tabular-nums text-xs font-medium text-muted-foreground">
              {s.mention_count}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
