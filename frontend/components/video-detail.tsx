"use client";

import { useRef } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/youtube-player";
import { VideoMentions } from "@/components/video-mentions";
import { ReanalyzeButton } from "@/components/reanalyze-button";
import { VideoScorecard } from "@/components/video-scorecard";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VideoDetailResponse } from "@/lib/types";

const STANCE_ORDER = ["buy", "neutral", "sell"] as const;
const STANCE_PILL: Record<string, string> = {
  buy: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  neutral: "bg-zinc-400/20 text-zinc-600 dark:text-zinc-300",
  sell: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
};

export function VideoDetail({ videoId }: { videoId: string }) {
  const t = useTranslations("VideoDetail");
  const ts = useTranslations("Stock.stance");
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const searchParams = useSearchParams();
  const initialTicker = searchParams.get("ticker");

  const { data, error, mutate } = useSWR<VideoDetailResponse>(`/api/videos/${videoId}`);

  if (error) {
    const notFound = (error as { status?: number }).status === 404;
    return (
      <p className="text-sm text-red-500">
        {notFound ? t("notFound") : t("loadError", { message: error.message })}
      </p>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const mentionTotal = data.groups.reduce((n, g) => n + g.mentions.length, 0);
  const stanceCounts: Record<string, number> = { buy: 0, neutral: 0, sell: 0 };
  for (const g of data.groups) stanceCounts[g.stance] = (stanceCounts[g.stance] ?? 0) + 1;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <div className="space-y-3 lg:sticky lg:top-14">
          <YouTubePlayer ref={playerRef} videoId={data.video.id} />
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight leading-snug line-clamp-2">
              {data.video.title}
            </h1>
            <div className="flex items-center gap-2">
              <ChannelAvatar
                title={data.video.channel.title}
                thumbnail={data.video.channel.thumbnail_url}
              />
              <div className="min-w-0 text-xs text-muted-foreground">
                <Link
                  href={`/channels/${data.video.channel.id}`}
                  className="block truncate font-medium text-foreground/80 hover:underline"
                >
                  {data.video.channel.title}
                </Link>
                <span className="flex items-center gap-2">
                  {formatDate(data.video.published_at)}
                  <a
                    href={`https://www.youtube.com/watch?v=${data.video.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("watchOnYoutube")}
                  </a>
                </span>
              </div>
            </div>
            {data.groups.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-xs">
                <span className="text-muted-foreground">
                  {t("stockCount", { count: data.groups.length })} ·{" "}
                  {t("mentionCount", { count: mentionTotal })}
                </span>
                {STANCE_ORDER.map((s) =>
                  stanceCounts[s] ? (
                    <span
                      key={s}
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
                        STANCE_PILL[s],
                      )}
                    >
                      {stanceCounts[s]} {ts(s)}
                    </span>
                  ) : null,
                )}
              </div>
            )}
          </div>
        </div>
        <VideoScorecard videoId={data.video.id} channelId={data.video.channel.id} />
      </div>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("mentionsHeading")}</h2>
          <ReanalyzeButton videoId={data.video.id} onDone={() => mutate()} />
        </div>
        <VideoMentions
          groups={data.groups}
          initialTicker={initialTicker}
          channelId={data.video.channel.id}
          onSeek={(s) => playerRef.current?.seekTo(s)}
        />
      </section>
    </div>
  );
}
