"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import type { TrendingStock } from "@/lib/types";

export function TrendingStocks() {
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
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("title")}
      </h2>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {data.map((s) => (
          <Link
            key={s.ticker}
            href={`/stocks/${s.ticker}`}
            data-testid="trending-pill"
            className="flex shrink-0 items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-accent"
          >
            <span className="font-mono font-medium">{s.ticker}</span>
            <span className="tabular-nums text-xs text-muted-foreground">
              {s.mention_count}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
