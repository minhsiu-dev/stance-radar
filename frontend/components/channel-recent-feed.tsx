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

const PAGE_SIZE = 20;

export function ChannelRecentFeed({ channelId }: { channelId: string }) {
  const t = useTranslations("ChannelDetail.recent");
  const tDetail = useTranslations("ChannelDetail");

  const getKey = (pageIndex: number, previous: ChannelRecentResponse | null) => {
    if (previous && previous.items.length < PAGE_SIZE) return null;
    return `/api/channels/${channelId}/recent?page=${pageIndex + 1}&page_size=${PAGE_SIZE}`;
  };
  const { data, error, setSize, isValidating } =
    useSWRInfinite<ChannelRecentResponse>(getKey, { revalidateFirstPage: false });

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
        {items.map((video) => (
          <div
            key={video.video_id}
            data-testid={`recent-video-${video.video_id}`}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:gap-3"
          >
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground sm:w-20 sm:pt-0.5">
              {formatDate(video.published_at)}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <Link
                href={`/videos/${video.video_id}`}
                className="line-clamp-1 text-sm font-medium hover:underline"
                title={video.video_title}
              >
                {video.video_title}
              </Link>
              <div className="flex flex-wrap items-center gap-1.5">
                {video.stances.map((s) => (
                  <Link
                    key={s.ticker}
                    href={`/stocks/${s.ticker}?channel=${channelId}`}
                    title={s.summary}
                  >
                    <StanceBadge stance={s.stance} ticker={s.ticker} confidence={s.confidence} />
                  </Link>
                ))}
              </div>
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
