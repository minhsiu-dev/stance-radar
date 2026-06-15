"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChannelActivityBars } from "@/components/channel-activity-bars";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { ChannelOverviewItem, ChannelOverviewResponse } from "@/lib/types";

const PAGE_SIZE = 10;

export function ChannelManager() {
  const t = useTranslations("Channels");
  const [message, setMessage] = useState<string | null>(null);

  const getKey = useCallback(
    (pageIndex: number, previous: ChannelOverviewResponse | null) => {
      if (previous && previous.items.length < PAGE_SIZE) return null;
      return `/api/channels/overview?page=${pageIndex + 1}&page_size=${PAGE_SIZE}`;
    },
    [],
  );
  const { data, mutate, setSize, isValidating } =
    useSWRInfinite<ChannelOverviewResponse>(getKey);

  const items = (data ?? []).flatMap((p) => p.items);
  const total = data?.[0]?.total ?? 0;
  const loaded = data !== undefined;
  const hasMore = items.length < total;

  // The add dialog can't target this infinite hook's $inf$ key via the global mutate
  // predicate, so it fires a window event we listen for to revalidate after a channel is added.
  useEffect(() => {
    const handler = () => mutate();
    window.addEventListener("channels:changed", handler);
    return () => window.removeEventListener("channels:changed", handler);
  }, [mutate]);

  // Auto-load the next page when the sentinel scrolls into view.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !isValidating && hasMore) {
            setSize((s) => s + 1);
          }
        },
        { rootMargin: "200px" },
      );
      obs.observe(node);
      observerRef.current = obs;
    },
    [setSize, isValidating, hasMore],
  );

  async function remove(channel: ChannelOverviewItem) {
    setMessage(null);
    if (!window.confirm(t("list.removePrompt", { name: channel.title }))) return;
    try {
      await apiFetch(`/api/channels/${channel.id}`, { method: "DELETE" });
      await mutate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("list.removeFailed"));
    }
  }

  return (
    <div className="space-y-3">
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {items.map((channel) => {
        const pending = channel.video_counts?.discovered ?? 0;
        const analyzed = channel.video_counts?.analyzed ?? 0;
        return (
          <Card key={channel.id}>
            <CardContent className="flex items-center gap-4 p-4">
              {channel.thumbnail_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={channel.thumbnail_url}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  href={`/channels/${channel.id}`}
                  className="block truncate font-medium hover:underline"
                >
                  {channel.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {t("list.analyzedCount", { count: analyzed })}
                  <span className="mx-1 opacity-60">·</span>
                  {channel.last_refreshed_at
                    ? t("list.lastUpdated", { date: formatDate(channel.last_refreshed_at) })
                    : t("list.neverUpdated")}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {channel.auto_analyze && (
                    <Badge
                      variant="outline"
                      className="border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    >
                      {t("list.autoBadge")}
                    </Badge>
                  )}
                  {pending > 0 && (
                    <Link href="/review">
                      <Badge variant="secondary">
                        {t("list.pendingBadge", { count: pending })}
                      </Badge>
                    </Link>
                  )}
                </div>
              </div>
              <ChannelActivityBars weekly={channel.weekly_activity} />
              <Button variant="destructive" size="sm" onClick={() => remove(channel)}>
                {t("list.remove")}
              </Button>
            </CardContent>
          </Card>
        );
      })}

      {loaded && total === 0 && (
        <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
      )}

      {hasMore && (
        <div ref={sentinelRef} data-testid="load-more-sentinel" className="h-1" />
      )}
    </div>
  );
}
