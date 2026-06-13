"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { TrendingStock } from "@/lib/types";

export function DiscussedStrip({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (ticker: string) => void;
}) {
  const t = useTranslations("Dashboard.discussed");
  const { data } = useSWR<TrendingStock[]>("/api/stocks/trending?limit=12&days=90");

  if (!data || data.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {t("title")}
      </h2>
      <div className="flex flex-wrap gap-2">
        {data.map((s) => {
          const on = selected.includes(s.ticker);
          return (
            <button
              key={s.ticker}
              type="button"
              data-testid="discussed-chip"
              aria-pressed={on}
              onClick={() => onToggle(s.ticker)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                on
                  ? "border-primary bg-primary/10 text-foreground"
                  : "bg-card text-muted-foreground hover:border-foreground/40 hover:bg-accent",
              )}
            >
              <span className="font-mono font-semibold tracking-tight">{s.ticker}</span>
              <span className="tabular-nums text-xs">{s.channel_count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
