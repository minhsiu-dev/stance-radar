"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { ChannelItem } from "@/lib/types";

export function ChannelManager() {
  const t = useTranslations("Channels");
  const [message, setMessage] = useState<string | null>(null);
  const { data: channels, mutate } = useSWR<ChannelItem[]>(
    "/api/channels",
    apiFetch,
  );

  async function remove(channel: ChannelItem) {
    setMessage(null);
    if (!window.confirm(t("list.removePrompt", { name: channel.title }))) {
      return;
    }
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
      {(channels ?? []).map((channel) => {
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
                  {channel.id}
                  <span className="mx-1 opacity-60">·</span>
                  {t("list.analyzedCount", { count: analyzed })}
                  <span className="mx-1 opacity-60">·</span>
                  {channel.last_refreshed_at
                    ? t("list.lastUpdated", {
                        date: formatDate(channel.last_refreshed_at),
                      })
                    : t("list.neverUpdated")}
                </p>
              </div>
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
              <Button
                variant="destructive"
                size="sm"
                onClick={() => remove(channel)}
              >
                {t("list.remove")}
              </Button>
            </CardContent>
          </Card>
        );
      })}
      {channels && channels.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
      )}
    </div>
  );
}
