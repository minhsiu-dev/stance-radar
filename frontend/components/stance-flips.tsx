"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { ArrowRight, Repeat } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { StanceBadge } from "@/components/stance-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import type { FlipItem, FlipsResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const WINDOWS = [
  { days: 7, key: "week" },
  { days: 30, key: "month" },
  { days: 90, key: "quarter" },
] as const;

function FlipRow({ flip }: { flip: FlipItem }) {
  const t = useTranslations("Dashboard.flips");
  return (
    <Card
      className={cn(
        "overflow-hidden",
        flip.is_reversal && "border-orange-500/40",
      )}
    >
      <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm">
        <Link
          href={`/channels/${flip.channel_id}`}
          className="flex min-w-0 items-center gap-2 hover:underline"
        >
          {flip.channel_thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={flip.channel_thumbnail}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
              {flip.channel_title.slice(0, 1)}
            </span>
          )}
          <span className="max-w-36 truncate font-medium">
            {flip.channel_title}
          </span>
        </Link>
        <Link
          href={`/stocks/${flip.ticker}`}
          className="font-mono font-semibold hover:underline"
        >
          {flip.ticker}
        </Link>
        <span className="flex items-center gap-1.5">
          <Link
            href={`/videos/${flip.prev.video_id}?ticker=${flip.ticker}`}
            title={`${formatDate(flip.prev.published_at)} · ${flip.prev.video_title}`}
          >
            <StanceBadge stance={flip.prev.stance} />
          </Link>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <Link
            href={`/videos/${flip.curr.video_id}?ticker=${flip.ticker}`}
            title={flip.curr.summary}
          >
            <StanceBadge stance={flip.curr.stance} />
          </Link>
        </span>
        {flip.is_reversal && (
          <span
            className="flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400"
            title={t("reversalHint")}
          >
            <Repeat className="h-3 w-3" />
            {t("reversal")}
          </span>
        )}
        <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {formatDate(flip.prev.published_at)} → {formatDate(flip.curr.published_at)}
        </span>
      </CardContent>
    </Card>
  );
}

export function StanceFlips() {
  const t = useTranslations("Dashboard.flips");
  const tWin = useTranslations("Trending");
  const [days, setDays] = useState(7);
  const { data, isLoading } = useSWR<FlipsResponse>(
    `/api/insights/flips?days=${days}&reversals_only=true`,
  );

  return (
    <section data-testid="stance-flips">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {t("title")}
        </h2>
        <div className="flex gap-1" role="group" aria-label={t("title")}>
          {WINDOWS.map((w) => {
            const active = days === w.days;
            return (
              <button
                key={w.days}
                type="button"
                aria-pressed={active}
                onClick={() => setDays(w.days)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent",
                )}
              >
                {tWin(w.key)}
              </button>
            );
          })}
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : data && data.items.length > 0 ? (
        <div className="space-y-2">
          {data.items.map((flip) => (
            <FlipRow
              key={`${flip.channel_id}-${flip.ticker}-${flip.curr.video_id}`}
              flip={flip}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </section>
  );
}
