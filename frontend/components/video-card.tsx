"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { StanceBadge } from "@/components/stance-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/lib/types";

function VideoThumb({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div
        aria-hidden
        className="flex h-16 w-28 shrink-0 items-center justify-center rounded bg-gradient-to-br from-muted to-muted/40 text-muted-foreground/60 sm:h-20 sm:w-36"
      >
        <Play className="h-6 w-6" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={title}
      onError={() => setFailed(true)}
      className="h-16 w-28 shrink-0 rounded object-cover sm:h-20 sm:w-36"
    />
  );
}

function StatusTag({ item }: { item: FeedItem }) {
  const t = useTranslations("Dashboard.feed");
  if (item.status === "no_transcript")
    return <Badge variant="secondary">{t("statusNoTranscript")}</Badge>;
  if (item.status === "failed")
    return (
      <Badge variant="destructive" title={item.error_message ?? undefined}>
        {t("statusFailed")}
      </Badge>
    );
  if (item.status === "pending")
    return <Badge variant="secondary">{t("statusPending")}</Badge>;
  if (item.stances.length === 0)
    return <span className="text-xs text-muted-foreground">{t("statusNoMentions")}</span>;
  return null;
}

export function VideoCard({
  item,
  highlightSet = null,
}: {
  item: FeedItem;
  highlightSet?: Set<string> | null;
}) {
  const t = useTranslations("Dashboard");
  return (
    <Card className="overflow-hidden transition-colors hover:bg-muted/30">
      <CardContent className="flex gap-3 p-3 sm:gap-4 sm:p-4">
        <Link href={`/videos/${item.video_id}`} className="shrink-0">
          <VideoThumb url={item.thumbnail_url} title={item.title} />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Link
            href={`/videos/${item.video_id}`}
            className="line-clamp-2 text-base font-medium leading-snug hover:underline"
          >
            {item.title}
          </Link>
          <p className="text-xs text-muted-foreground">
            <Link
              href={`/channels/${item.channel.id}`}
              className="font-medium text-foreground/70 hover:text-foreground hover:underline"
            >
              {item.channel.title}
            </Link>
            <span className="mx-1.5 opacity-60">·</span>
            {formatDate(item.published_at)}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-1.5">
            <StatusTag item={item} />
            {item.stances.map((s) => (
              <Link
                key={s.ticker}
                href={`/videos/${item.video_id}?ticker=${s.ticker}`}
                title={s.summary}
                className={cn(
                  "transition-transform hover:-translate-y-px",
                  highlightSet && !highlightSet.has(s.ticker) && "opacity-40",
                )}
              >
                <StanceBadge stance={s.stance} ticker={s.ticker} confidence={s.confidence} />
              </Link>
            ))}
            {item.dropped_tickers.length > 0 && (
              <span className="text-[11px] text-muted-foreground" title={t("feed.droppedHint")}>
                {t("feed.dropped", { tickers: item.dropped_tickers.join(", ") })}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
