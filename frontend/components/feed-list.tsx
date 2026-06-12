"use client";

import { Link } from "@/i18n/navigation";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { StanceBadge } from "@/components/stance-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { FeedItem, FeedResponse } from "@/lib/types";

function StatusTag({ item }: { item: FeedItem }) {
  const t = useTranslations("Dashboard.feed");

  if (item.status === "no_transcript") {
    return <Badge variant="secondary">{t("statusNoTranscript")}</Badge>;
  }
  if (item.status === "failed") {
    return (
      <Badge variant="destructive" title={item.error_message ?? undefined}>
        {t("statusFailed")}
      </Badge>
    );
  }
  if (item.status === "pending") {
    return <Badge variant="secondary">{t("statusPending")}</Badge>;
  }
  if (item.stances.length === 0) {
    return <span className="text-xs text-muted-foreground">{t("statusNoMentions")}</span>;
  }
  return null;
}

export function FeedList() {
  const t = useTranslations("Dashboard");
  const { data, error, isLoading } = useSWR<FeedResponse>(
    "/api/feed?page=1&page_size=50",
    apiFetch,
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-red-500">
        {t("feed.loadError", { message: error.message })}
      </p>
    );
  }
  if (!data || data.items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("empty.prompt")}
          <Link href="/channels" className="mx-1 underline">
            {t("empty.linkLabel")}
          </Link>
          {t("empty.hint")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {data.items.map((item) => (
        <Card key={item.video_id}>
          <CardContent className="flex gap-4 p-4">
            {item.thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnail_url}
                alt=""
                className="h-20 w-36 shrink-0 rounded object-cover"
              />
            )}
            <div className="min-w-0 space-y-2">
              <a
                href={`https://www.youtube.com/watch?v=${item.video_id}`}
                target="_blank"
                rel="noreferrer"
                className="line-clamp-2 font-medium hover:underline"
              >
                {item.title}
              </a>
              <p className="text-xs text-muted-foreground">
                {item.channel.title} · {formatDate(item.published_at)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <StatusTag item={item} />
                {item.stances.map((s) => (
                  <Link key={s.ticker} href={`/stocks/${s.ticker}`} title={s.summary}>
                    <StanceBadge stance={s.stance} ticker={s.ticker} />
                  </Link>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
