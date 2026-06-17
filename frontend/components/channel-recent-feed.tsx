"use client";

import { useEffect, useRef } from "react";
import useSWRInfinite from "swr/infinite";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StanceBadge } from "@/components/stance-badge";
import { formatDate } from "@/lib/format";
import type { ChannelRecentResponse } from "@/lib/types";

const PAGE_SIZE = 30;

export function ChannelRecentFeed({ channelId }: { channelId: string }) {
  const t = useTranslations("ChannelDetail.recent");
  const tDetail = useTranslations("ChannelDetail");

  const getKey = (pageIndex: number, previous: ChannelRecentResponse | null) => {
    if (previous && previous.items.length < PAGE_SIZE) return null;
    return `/api/channels/${channelId}/recent?page=${pageIndex + 1}&page_size=${PAGE_SIZE}`;
  };
  const { data, error, setSize, isValidating } =
    useSWRInfinite<ChannelRecentResponse>(getKey, {
      revalidateFirstPage: false,
    });

  const pages = data ?? [];
  const items = pages.flatMap((p) => p.items);
  const total = pages[0]?.total ?? 0;
  const hasMore = items.length < total;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isValidating && hasMore) {
          setSize((s) => s + 1);
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [setSize, isValidating, hasMore]);

  if (error) {
    return (
      <p className="text-sm text-red-500">
        {tDetail("loadError", { message: error.message })}
      </p>
    );
  }
  if (!data) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
    );
  }

  return (
    <Card>
      <CardContent className="divide-y p-0">
        {items.map((it) => (
          <div
            key={`${it.video_id}-${it.ticker}`}
            className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-3"
          >
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground sm:w-20 sm:pt-0.5">
              {formatDate(it.published_at)}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/stocks/${it.ticker}?channel=${channelId}`}
                  className="shrink-0"
                >
                  <StanceBadge
                    stance={it.stance}
                    ticker={it.ticker}
                    confidence={it.confidence}
                  />
                </Link>
                <Link
                  href={`/videos/${it.video_id}`}
                  className="line-clamp-1 text-sm font-medium hover:underline"
                  title={it.video_title}
                >
                  {it.video_title}
                </Link>
              </div>
              {it.summary && (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {it.summary}
                </p>
              )}
            </div>
          </div>
        ))}
        {hasMore && (
          <div ref={sentinelRef} data-testid="recent-sentinel" aria-hidden className="h-1" />
        )}
      </CardContent>
    </Card>
  );
}
