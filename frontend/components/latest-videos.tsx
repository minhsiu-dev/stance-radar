"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { VideoCard } from "@/components/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { FeedResponse } from "@/lib/types";

export function LatestVideos() {
  const t = useTranslations("Dashboard");
  const { data, error } = useSWR<FeedResponse>("/api/feed?page_size=5");

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{t("latest")}</h2>
        <Link href="/videos" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          {t("viewAll")}
        </Link>
      </div>
      {error && <p className="text-sm text-red-500">{t("feed.loadError", { message: error.message })}</p>}
      {!data && !error && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      )}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("empty.prompt")}</p>
      )}
      {data?.items.map((item) => <VideoCard key={item.video_id} item={item} />)}
    </section>
  );
}
