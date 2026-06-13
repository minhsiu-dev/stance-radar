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
import { useScrollShrink } from "@/lib/use-scroll-shrink";
import type { VideoDetailResponse } from "@/lib/types";

export function VideoDetail({ videoId }: { videoId: string }) {
  const t = useTranslations("VideoDetail");
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const searchParams = useSearchParams();
  const initialTicker = searchParams.get("ticker");
  const shrink = useScrollShrink(220);

  const { data, error } = useSWR<VideoDetailResponse>(`/api/videos/${videoId}`);

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
    <div className="space-y-4">
      <div data-testid="video-sticky" className="sticky top-14 z-30 bg-background pb-2">
        <div
          data-testid="video-sizer"
          className="mx-auto transition-[max-width] duration-75"
          style={{ maxWidth: `${100 - shrink * 55}%` }}
        >
          <YouTubePlayer ref={playerRef} videoId={data.video.id} />
        </div>
        <div
          className="overflow-hidden transition-all duration-75"
          style={{ maxHeight: `${(1 - shrink) * 80}px`, opacity: 1 - shrink }}
        >
          <h1 className="mt-2 text-2xl font-semibold tracking-tight leading-snug line-clamp-2">
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
      <VideoMentions
        groups={data.groups}
        initialTicker={initialTicker}
        onSeek={(s) => playerRef.current?.seekTo(s)}
      />
    </div>
  );
}
