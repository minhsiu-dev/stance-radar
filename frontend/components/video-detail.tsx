"use client";

import { useRef } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/youtube-player";
import { VideoMentions } from "@/components/video-mentions";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import type { VideoDetailResponse } from "@/lib/types";

export function VideoDetail({ videoId }: { videoId: string }) {
  const t = useTranslations("VideoDetail");
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const searchParams = useSearchParams();
  const initialTicker = searchParams.get("ticker");

  const { data, error } = useSWR<VideoDetailResponse>(`/api/videos/${videoId}`);

  if (error) {
    const notFound = (error as { status?: number }).status === 404;
    return (
      <div className="space-y-3">
        <Link href="/videos" className="text-sm text-muted-foreground hover:underline">
          {t("backToVideos")}
        </Link>
        <p className="text-sm text-red-500">
          {notFound ? t("notFound") : t("loadError", { message: error.message })}
        </p>
      </div>
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
    <div className="space-y-4">
      <Link href="/videos" className="text-sm text-muted-foreground hover:underline">
        {t("backToVideos")}
      </Link>
      <YouTubePlayer ref={playerRef} videoId={data.video.id} />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold leading-snug">{data.video.title}</h1>
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
      <VideoMentions
        groups={data.groups}
        initialTicker={initialTicker}
        onSeek={(s) => playerRef.current?.seekTo(s)}
      />
    </div>
  );
}
