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
import { Skeleton } from "@/components/ui/skeleton";
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
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <div className="space-y-2 lg:sticky lg:top-14">
          <YouTubePlayer ref={playerRef} videoId={data.video.id} />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight leading-snug line-clamp-2">
              {data.video.title}
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Link href={`/channels/${data.video.channel.id}`} className="font-medium text-foreground/70 hover:underline">
                {data.video.channel.title}
              </Link>
              <span className="opacity-60">·</span>
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
            </p>
          </div>
        </div>
      </div>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("mentionsHeading")}</h2>
          <div className="flex items-center gap-3">
            {data.groups.length > 0 && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {t("jumpHint")}
              </span>
            )}
            <ReanalyzeButton videoId={data.video.id} onDone={() => mutate()} />
          </div>
        </div>
        <VideoMentions
          groups={data.groups}
          initialTicker={initialTicker}
          onSeek={(s) => playerRef.current?.seekTo(s)}
        />
      </section>
    </div>
  );
}
