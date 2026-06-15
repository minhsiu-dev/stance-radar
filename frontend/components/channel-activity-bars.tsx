"use client";

import { useTranslations } from "next-intl";
import type { WeeklyActivity } from "@/lib/types";

export function ChannelActivityBars({ weekly }: { weekly: WeeklyActivity[] }) {
  const t = useTranslations("Channels.activity");
  const max = Math.max(1, ...weekly.map((w) => w.total));

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex h-10 items-end gap-1">
        {weekly.map((w) => (
          <div
            key={w.week_start}
            title={t("tooltip", { total: w.total, analyzed: w.analyzed })}
            className="relative flex h-full w-3 items-end overflow-hidden rounded-sm bg-muted"
          >
            <div
              data-testid="bar-total"
              className="w-full rounded-sm bg-zinc-300 dark:bg-zinc-600"
              style={{ height: `${(w.total / max) * 100}%` }}
            />
            <div
              data-testid="bar-analyzed"
              className="absolute inset-x-0 bottom-0 rounded-sm bg-sky-500"
              style={{ height: `${(w.analyzed / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-sm bg-zinc-300 dark:bg-zinc-600" />
        <span className="inline-block h-2 w-2 rounded-sm bg-sky-500" />
        {t("legend")}
      </span>
    </div>
  );
}
