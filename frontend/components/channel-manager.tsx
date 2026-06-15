"use client";

import { useState } from "react";
import useSWR from "swr";
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
  const [page, setPage] = useState(1);
  const { data, mutate } = useSWR<ChannelOverviewResponse>(
    `/api/channels/overview?page=${page}&page_size=${PAGE_SIZE}`,
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function remove(channel: ChannelOverviewItem) {
    setMessage(null);
    if (!window.confirm(t("list.removePrompt", { name: channel.title }))) return;
    try {
      await apiFetch(`/api/channels/${channel.id}`, { method: "DELETE" });
      if (items.length === 1 && page > 1) setPage((p) => p - 1);
      else await mutate();
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

      {data && total === 0 && (
        <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t("pager.prev")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("pager.page", { page, pages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
          >
            {t("pager.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
