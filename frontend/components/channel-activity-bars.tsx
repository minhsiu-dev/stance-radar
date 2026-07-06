"use client";

import { useTranslations } from "next-intl";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { formatDate } from "@/lib/format";
import type { WeeklyActivity } from "@/lib/types";

// A full-height bar represents this many videos in a week (~1/day); busier weeks clip to full.
// Fixed (not per-channel) so posting cadence is comparable across every channel.
const WEEKLY_BASELINE = 7;

export function ChannelActivityBars({ weekly }: { weekly: WeeklyActivity[] }) {
  const t = useTranslations("Channels.activity");

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex h-10 items-end gap-1">
        {weekly.map((w) => {
          const totalPct = Math.min(100, (w.total / WEEKLY_BASELINE) * 100);
          const analyzedPct = Math.min(100, (w.analyzed / WEEKLY_BASELINE) * 100);
          return (
            <HoverCard key={w.week_start}>
              <HoverCardTrigger
                delay={100}
                render={
                  <div className="relative flex h-full w-3 cursor-help items-end overflow-hidden rounded-none bg-muted">
                    <div
                      data-testid="bar-total"
                      className="w-full bg-zinc-300 dark:bg-zinc-600"
                      style={{ height: `${totalPct}%` }}
                    />
                    <div
                      data-testid="bar-analyzed"
                      className="absolute inset-x-0 bottom-0 bg-sky-500"
                      style={{ height: `${analyzedPct}%` }}
                    />
                  </div>
                }
              />
              <HoverCardContent className="w-auto px-3 py-2 text-xs">
                <div className="font-medium">
                  {t("weekOf", { date: formatDate(w.week_start) })}
                </div>
                <div className="text-muted-foreground">
                  {t("tooltip", { total: w.total, analyzed: w.analyzed })}
                </div>
              </HoverCardContent>
            </HoverCard>
          );
        })}
      </div>
      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-none bg-zinc-300 dark:bg-zinc-600" />
        <span className="inline-block h-2 w-2 rounded-none bg-sky-500" />
        {t("legend")}
      </span>
    </div>
  );
}
