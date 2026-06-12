"use client";

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
          <a
            href={`https://www.youtube.com/watch?v=${flip.prev.video_id}`}
            target="_blank"
            rel="noreferrer"
            title={`${formatDate(flip.prev.published_at)} · ${flip.prev.video_title}`}
          >
            <StanceBadge stance={flip.prev.stance} />
          </a>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <a
            href={`https://www.youtube.com/watch?v=${flip.curr.video_id}`}
            target="_blank"
            rel="noreferrer"
            title={flip.curr.summary}
          >
            <StanceBadge stance={flip.curr.stance} />
          </a>
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
  const { data, isLoading } = useSWR<FlipsResponse>(
    "/api/insights/flips?days=30",
  );

  if (isLoading) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {t("title")}
        </h2>
        <Skeleton className="h-12 w-full" />
      </section>
    );
  }
  if (!data || data.items.length === 0) return null;

  return (
    <section data-testid="stance-flips">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {t("title")}
        <span className="ml-2 normal-case tracking-normal opacity-70">
          {t("window", { days: data.window_days })}
        </span>
      </h2>
      <div className="space-y-2">
        {data.items.map((flip) => (
          <FlipRow
            key={`${flip.channel_id}-${flip.ticker}-${flip.curr.video_id}`}
            flip={flip}
          />
        ))}
      </div>
    </section>
  );
}
