"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StanceBadge } from "@/components/stance-badge";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type {
  ChannelDetailDto,
  ChannelVideoItem,
  ChannelVideosResponse,
  VideoStatus,
} from "@/lib/types";

const STAT_ORDER: VideoStatus[] = [
  "analyzed", "discovered", "pending", "failed", "no_transcript", "skipped",
];
// 可勾選/可操作的狀態(analyzed、pending 不提供批次操作)
const ACTIONABLE: ReadonlySet<VideoStatus> = new Set([
  "discovered", "failed", "no_transcript", "skipped",
]);
const BADGE_VARIANT: Record<
  VideoStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  analyzed: "default",
  discovered: "secondary",
  pending: "secondary",
  failed: "destructive",
  no_transcript: "outline",
  skipped: "outline",
};

function rowActionKey(status: VideoStatus): "analyze" | "retry" | null {
  if (status === "discovered" || status === "skipped") return "analyze";
  if (status === "failed" || status === "no_transcript") return "retry";
  return null;
}

export function ChannelDetail({ channelId }: { channelId: string }) {
  const t = useTranslations("ChannelDetail");
  const tChannels = useTranslations("Channels");
  const { mutate } = useSWRConfig();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detailKey = `/api/channels/${channelId}`;
  const videosKey =
    `/api/channels/${channelId}/videos?page=1&page_size=50` +
    (statusFilter === "all" ? "" : `&status=${statusFilter}`);
  const { data: detail, error: detailError } =
    useSWR<ChannelDetailDto>(detailKey);
  const { data: videos, error: videosError } =
    useSWR<ChannelVideosResponse>(videosKey);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function act(path: "analyze" | "skip", ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/api/videos/${path}`, {
        method: "POST",
        body: JSON.stringify({ video_ids: ids }),
      });
      setSelected(new Set());
      if (path === "analyze") setMessage(t("videos.queued"));
      await mutate(
        (key) =>
          typeof key === "string" &&
          (key.startsWith(`/api/channels/${channelId}`) ||
            key.startsWith("/api/videos") ||
            key.startsWith("/api/jobs")),
      );
    } catch (err) {
      setMessage(
        t("videos.actionFailed", {
          message: err instanceof Error ? err.message : "?",
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  if (detailError) {
    return (
      <p className="text-sm text-red-500">
        {t("loadError", { message: detailError.message })}
      </p>
    );
  }
  if (!detail) {
    return <Skeleton className="h-48 w-full" />;
  }

  const selectedIds = [...selected];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {detail.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={detail.thumbnail_url}
            alt=""
            className="h-16 w-16 rounded-full object-cover"
          />
        )}
        <div>
          <h1 className="text-xl font-semibold">{detail.title}</h1>
          <p className="text-xs text-muted-foreground">
            {t("added", { date: formatDate(detail.added_at) })} ·{" "}
            {detail.last_refreshed_at
              ? tChannels("list.lastUpdated", {
                  date: formatDate(detail.last_refreshed_at),
                })
              : tChannels("list.neverUpdated")}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STAT_ORDER.map((status) => (
          <Card key={status}>
            <CardContent className="p-4">
              <p className="text-2xl font-semibold">
                {detail.status_counts[status] ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(`stats.${status}`)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stats.topTickers")}</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.top_tickers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("stats.noTickers")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {detail.top_tickers.map((stat) => (
                <div key={stat.ticker} className="flex items-center gap-2">
                  <span className="font-medium">{stat.ticker}</span>
                  <span className="text-xs text-muted-foreground">
                    {stat.buy > 0 && `▲${stat.buy} `}
                    {stat.neutral > 0 && `•${stat.neutral} `}
                    {stat.sell > 0 && `▼${stat.sell}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t("videos.title")}</CardTitle>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <>
                <span className="text-xs text-muted-foreground">
                  {t("videos.selectedCount", { count: selectedIds.length })}
                </span>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => act("analyze", selectedIds)}
                >
                  {t("videos.analyzeSelected")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => act("skip", selectedIds)}
                >
                  {t("videos.skipSelected")}
                </Button>
              </>
            )}
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter((v as string) ?? "all")}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("videos.filterAll")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("videos.filterAll")}</SelectItem>
                {STAT_ORDER.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(`videos.status.${status}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {message && (
            <p className="pb-2 text-sm text-muted-foreground">{message}</p>
          )}
          {videosError && (
            <p className="text-sm text-red-500">
              {t("loadError", { message: videosError.message })}
            </p>
          )}
          {videos && videos.items.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("videos.empty")}
            </p>
          )}
          {(videos?.items ?? []).map((video) => (
            <VideoRow
              key={video.id}
              video={video}
              checked={selected.has(video.id)}
              onToggle={() => toggle(video.id)}
              onAct={act}
              busy={busy}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function VideoRow({
  video,
  checked,
  onToggle,
  onAct,
  busy,
}: {
  video: ChannelVideoItem;
  checked: boolean;
  onToggle: () => void;
  onAct: (path: "analyze" | "skip", ids: string[]) => Promise<void>;
  busy: boolean;
}) {
  const t = useTranslations("ChannelDetail");
  const actionable = ACTIONABLE.has(video.status);
  const action = rowActionKey(video.status);

  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
      <input
        type="checkbox"
        className="h-4 w-4 accent-primary disabled:opacity-30"
        checked={checked}
        onChange={onToggle}
        disabled={!actionable}
      />
      {video.thumbnail_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={video.thumbnail_url}
          alt=""
          className="h-12 w-20 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <a
          href={`https://www.youtube.com/watch?v=${video.id}`}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-1 text-sm font-medium hover:underline"
        >
          {video.title}
        </a>
        <p className="text-xs text-muted-foreground">
          {formatDate(video.published_at)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {video.stances.map((s) => (
          <StanceBadge key={s.ticker} stance={s.stance} ticker={s.ticker} />
        ))}
        <Badge
          variant={BADGE_VARIANT[video.status]}
          title={video.error_message ?? undefined}
        >
          {t(`videos.status.${video.status}`)}
        </Badge>
        {action && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onAct("analyze", [video.id])}
          >
            {t(`videos.${action}`)}
          </Button>
        )}
        {actionable && video.status !== "skipped" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onAct("skip", [video.id])}
          >
            {t("videos.skip")}
          </Button>
        )}
      </div>
    </div>
  );
}
