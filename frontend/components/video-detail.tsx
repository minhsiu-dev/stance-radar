"use client";

import { useRef } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/youtube-player";
import { MentionsByStock } from "@/components/mentions-by-stock";
import { MentionsQuotes } from "@/components/mentions-quotes";
import { ReanalyzeButton } from "@/components/reanalyze-button";
import { VideoScorecard } from "@/components/video-scorecard";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/format";
import type { VideoDetailResponse } from "@/lib/types";

export function VideoDetail({ videoId }: { videoId: string }) {
  const t = useTranslations("VideoDetail");
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

  return (
    <div className="lg:grid lg:grid-cols-[2fr_3fr] lg:gap-6">
      {/* sticky video + info: pins through the scroll, content scrolls under it */}
      <div className="sticky top-14 z-10 self-start space-y-3 bg-background pb-4 -mx-0.5 px-0.5">
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
        </div>
      </div>

      {/* right column: TL;DR (when present) + tabs */}
      <div className="mt-6 space-y-4 lg:mt-0">
        {data.video.tldr && data.video.tldr.length > 0 && (
          <section className="rounded-lg border bg-muted/30 p-4">
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              {t("tldrHeading")}
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {data.video.tldr.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}
        <Tabs defaultValue={initialTicker ? "byStock" : "scorecard"}>
          <div className="flex flex-wrap items-center justify-between gap-2 lg:sticky lg:top-14 lg:z-[5] lg:bg-background lg:py-2 lg:-mx-0.5 lg:px-0.5">
            <TabsList>
              <TabsTrigger value="scorecard">{t("callPerformance")}</TabsTrigger>
              <TabsTrigger value="byStock">{t("byStock")}</TabsTrigger>
              <TabsTrigger value="quotes">{t("quotesByTime")}</TabsTrigger>
            </TabsList>
            <ReanalyzeButton videoId={data.video.id} onDone={() => mutate()} />
          </div>
          <TabsContent value="scorecard">
            <VideoScorecard videoId={data.video.id} channelId={data.video.channel.id} />
          </TabsContent>
          <TabsContent value="byStock">
            <MentionsByStock
              groups={data.groups}
              initialTicker={initialTicker}
              channelId={data.video.channel.id}
            />
          </TabsContent>
          <TabsContent value="quotes">
            <MentionsQuotes
              groups={data.groups}
              channelId={data.video.channel.id}
              onSeek={(s) => playerRef.current?.seekTo(s)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
