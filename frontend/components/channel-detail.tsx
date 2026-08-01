"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { useTranslations } from "next-intl";
import { ExternalLink, Play, Zap, ZapOff } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { ChannelPerformanceSummary } from "@/components/channel-performance-summary";
import { ChannelTickerTable } from "@/components/channel-ticker-table";
import { ChannelTrackRecordChart } from "@/components/channel-track-record-chart";
import { ChannelRecentFeed } from "@/components/channel-recent-feed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StanceBadge } from "@/components/stance-badge";
import { useAdmin } from "@/components/admin-provider";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type {
  ChannelDetailDto,
  ChannelVideoItem,
  ChannelVideosResponse,
  JobInfo,
  VideoStatus,
} from "@/lib/types";

const PAGE_SIZE = 50;
const STAT_ORDER: VideoStatus[] = [
  "analyzed", "discovered", "pending", "failed", "no_transcript", "skipped",
];
// The three core cells are always shown; the rest only appear when >0
const ALWAYS_SHOW: ReadonlySet<VideoStatus> = new Set([
  "analyzed", "discovered", "skipped",
]);
// Selectable / actionable statuses (analyzed and pending don't support batch operations)
const ACTIONABLE: ReadonlySet<VideoStatus> = new Set([
  "discovered", "failed", "no_transcript", "skipped",
]);
// skipped can't be skipped (skipping an already-skipped video is meaningless), and the backend also rejects analyzed
const SKIPPABLE: ReadonlySet<VideoStatus> = new Set([
  "discovered", "failed", "no_transcript",
]);
const BADGE_VARIANT: Record<
  VideoStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  analyzed: "outline",
  discovered: "secondary",
  pending: "secondary",
  failed: "destructive",
  no_transcript: "outline",
  skipped: "outline",
};

function rowActionKey(
  status: VideoStatus,
): "analyze" | "retry" | "reanalyze" | null {
  if (status === "discovered" || status === "skipped") return "analyze";
  if (status === "failed" || status === "no_transcript") return "retry";
  // After a prompt upgrade, old videos can be re-run (idempotent: clears old mentions/stances first)
  if (status === "analyzed") return "reanalyze";
  return null;
}

export function ChannelDetail({ channelId }: { channelId: string }) {
  const t = useTranslations("ChannelDetail");
  const tChannels = useTranslations("Channels");
  const { mutate } = useSWRConfig();
  const { authenticated, handleAuthError } = useAdmin();
  // The chart is the primary content; the table is collapsed underneath as a detail
  // lookup. Conditionally rendered rather than CSS-hidden — that way
  // ChannelTickerTable's useSWRInfinite doesn't fire a request until it's expanded.
  const [showTable, setShowTable] = useState(false);
  // No directional calls at all -> the chart is empty and the whole tab would
  // look broken, so expand the table automatically. Memoized (stable identity
  // across renders) as defense in depth: the chart itself now dedupes calls
  // by value, but keeping this prop stable means a fresh `onEmptyChange`
  // identity can never be the thing that re-triggers the child's effect.
  const handleTrackRecordEmptyChange = useCallback((empty: boolean) => {
    if (empty) setShowTable(true);
  }, []);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detailKey = `/api/channels/${channelId}`;
  const { data: detail, error: detailError } =
    useSWR<ChannelDetailDto>(detailKey);

  // Video list is paginated: 50 at a time, fetching more with "load more"
  const getVideosKey = useMemo(
    () =>
      (pageIndex: number, previous: ChannelVideosResponse | null) => {
        if (previous && previous.items.length < PAGE_SIZE) return null;
        return (
          `/api/channels/${channelId}/videos?page=${pageIndex + 1}&page_size=${PAGE_SIZE}` +
          (statusFilter === "all" ? "" : `&status=${statusFilter}`)
        );
      },
    [channelId, statusFilter],
  );
  const {
    data: videoPages,
    error: videosError,
    setSize,
    isValidating,
    mutate: mutateVideos,
  } = useSWRInfinite<ChannelVideosResponse>(getVideosKey);
  const videoItems = (videoPages ?? []).flatMap((p) => p.items);
  const videosTotal = videoPages?.[0]?.total ?? 0;
  const videosLoaded = videoPages !== undefined;
  const hasMore = videoItems.length < videosTotal;
  // Auto-load the next page on scroll-to-bottom (videos already in the DB), replacing the "load more" button.
  // Use a callback ref instead of useEffect: the sentinel lives inside TabsContent, so its mount timing is
  // out of sync with this component's render; a callback ref attaches the observer only when the node actually mounts.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !isValidating && hasMore) {
            setSize((s) => s + 1);
          }
        },
        { rootMargin: "200px" },
      );
      obs.observe(node);
      observerRef.current = obs;
    },
    [setSize, isValidating, hasMore],
  );

  // Select-all only affects "already loaded and actionable" videos (respecting the current status filter)
  const actionableIds = useMemo(
    () => videoItems.filter((v) => ACTIONABLE.has(v.status)).map((v) => v.id),
    [videoItems],
  );
  const allActionableSelected =
    actionableIds.length > 0 && actionableIds.every((id) => selected.has(id));
  const someActionableSelected = actionableIds.some((id) => selected.has(id));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        someActionableSelected && !allActionableSelected;
    }
  }, [someActionableSelected, allActionableSelected]);

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allActionableSelected) actionableIds.forEach((id) => next.delete(id));
      else actionableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleAutoAnalyze() {
    if (!detail) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/api/channels/${channelId}`, {
        method: "PATCH",
        body: JSON.stringify({ auto_analyze: !detail.auto_analyze }),
      });
      // Note: the filter form of mutate "skips" useSWRInfinite keys starting with $inf$
      // (SWR 2.x internal behavior), so the video list must be refreshed separately via the hook-bound mutate.
      await Promise.all([
        mutate(
          (key) =>
            typeof key === "string" && key.startsWith("/api/channels"),
        ),
        mutateVideos(),
      ]);
    } catch (err) {
      handleAuthError(err);
      setMessage(
        t("videos.actionFailed", {
          message: err instanceof Error ? err.message : "?",
        }),
      );
    } finally {
      setBusy(false);
    }
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
      // Note: the filter form of mutate "skips" useSWRInfinite keys starting with $inf$
      // (SWR 2.x internal behavior), so the predicate never sees the video list's infinite key,
      // which means we must refresh separately via the hook-bound mutateVideos() (re-fetches each loaded page).
      await Promise.all([
        mutate(
          (key) =>
            typeof key === "string" &&
            (key.startsWith(`/api/channels/${channelId}`) ||
              key.startsWith("/api/videos") ||
              key.startsWith("/api/jobs")),
        ),
        mutateVideos(),
      ]);
    } catch (err) {
      handleAuthError(err);
      setMessage(
        t("videos.actionFailed", {
          message: err instanceof Error ? err.message : "?",
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadOlder() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch<{ job_id: number; created: boolean }>(
        `/api/channels/${channelId}/load-older`,
        { method: "POST" },
      );
      // Another job is already running (backend returns created:false) → prompt to try again later, no refresh
      if (res && res.created === false) {
        setMessage(t("videos.loadOlderBusy"));
        return;
      }
      // Poll /api/jobs/current until the load_older job is no longer running (single-job model;
      // getting created:true above means this is the current job). Call apiFetch directly,
      // which tests can drive with a mocked fetch (returning non-running ends it immediately).
      for (let i = 0; i < 150; i++) {
        const job = await apiFetch<JobInfo | null>("/api/jobs/current");
        if (!job || job.status !== "running") break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      // Note: the filter form of mutate skips useSWRInfinite's $inf$ keys,
      // so the video list must be refreshed separately via the hook-bound mutateVideos().
      await Promise.all([
        mutate(
          (key) =>
            typeof key === "string" &&
            key.startsWith(`/api/channels/${channelId}`),
        ),
        mutateVideos(),
      ]);
    } catch (err) {
      handleAuthError(err);
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

  const visibleStats = STAT_ORDER.filter(
    (s) => ALWAYS_SHOW.has(s) || (detail.status_counts[s] ?? 0) > 0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        {detail.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={detail.thumbnail_url}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-border"
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {detail.title}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("added", { date: formatDate(detail.added_at) })}
            <span className="mx-2 opacity-60">·</span>
            {detail.last_refreshed_at
              ? tChannels("list.lastUpdated", {
                  date: formatDate(detail.last_refreshed_at),
                })
              : tChannels("list.neverUpdated")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          {authenticated && (
            <button
              type="button"
              onClick={toggleAutoAnalyze}
              disabled={busy}
              aria-pressed={detail.auto_analyze}
              title={t("autoAnalyze.hint")}
              data-testid="auto-analyze-toggle"
              className={
                detail.auto_analyze
                  ? "inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-500/25 dark:text-sky-300"
                  : "inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              }
            >
              {detail.auto_analyze ? (
                <Zap className="h-3.5 w-3.5" />
              ) : (
                <ZapOff className="h-3.5 w-3.5" />
              )}
              {detail.auto_analyze
                ? t("autoAnalyze.on")
                : t("autoAnalyze.off")}
            </button>
          )}
          <a
            href={`https://www.youtube.com/channel/${detail.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            YouTube
          </a>
        </div>
      </div>

      <ChannelPerformanceSummary channelId={channelId} />

      <Tabs defaultValue="tickers">
        <TabsList>
          <TabsTrigger value="tickers">{t("tabs.tickers")}</TabsTrigger>
          <TabsTrigger value="recent">{t("tabs.recent")}</TabsTrigger>
          <TabsTrigger value="videos">{t("tabs.videos")}</TabsTrigger>
        </TabsList>

        <TabsContent value="tickers" className="space-y-4">
          <ChannelTrackRecordChart
            channelId={channelId}
            onEmptyChange={handleTrackRecordEmptyChange}
          />
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="toggle-ticker-table"
              aria-expanded={showTable}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable
                ? t("trackRecordChart.hideTable")
                : t("trackRecordChart.showTable")}
            </Button>
            {showTable && (
              <div className="mt-4">
                <ChannelTickerTable channelId={channelId} />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="recent">
          <ChannelRecentFeed channelId={channelId} />
        </TabsContent>

        <TabsContent value="videos" className="space-y-6">
          <div className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-6">
            {visibleStats.map((status) => (
              <Card key={status} className="bg-card/50">
                <CardContent className="p-4">
                  <p className="font-mono text-3xl font-semibold tabular-nums">
                    {detail.status_counts[status] ?? 0}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(`stats.${status}`)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-y-2 space-y-0">
              <CardTitle className="text-base">{t("videos.title")}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {authenticated && actionableIds.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={allActionableSelected}
                      onChange={toggleSelectAll}
                      disabled={busy}
                      data-testid="select-all"
                      aria-label={t("videos.selectAll")}
                    />
                    {t("videos.selectAll")}
                  </label>
                )}
                {authenticated && selectedIds.length > 0 && (
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
              {videosLoaded && videoItems.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("videos.empty")}
                </p>
              )}
              {videoItems.map((video) => (
                <VideoRow
                  key={video.id}
                  video={video}
                  checked={selected.has(video.id)}
                  onToggle={() => toggle(video.id)}
                  onAct={act}
                  busy={busy}
                  authenticated={authenticated}
                />
              ))}
              {videosLoaded && videoItems.length > 0 && (
                <div className="space-y-3 pt-2">
                  <p className="text-center text-xs text-muted-foreground">
                    {t("videos.loaded", {
                      loaded: videoItems.length,
                      total: videosTotal,
                    })}
                  </p>
                  {hasMore ? (
                    // Auto-load the next page on scroll-to-bottom; the sentinel triggers setSize as it enters the viewport
                    <div
                      ref={sentinelRef}
                      data-testid="load-more-sentinel"
                      className="py-2"
                    >
                      {isValidating && (
                        <Skeleton className="mx-auto h-8 w-full" />
                      )}
                    </div>
                  ) : (
                    authenticated && (
                      // All videos in the DB are loaded → dig back for older videos (go to skipped, no review needed)
                      <div className="flex justify-center">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={loadOlder}
                        >
                          {busy
                            ? t("videos.loadingOlder")
                            : t("videos.loadOlder")}
                        </Button>
                      </div>
                    )
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const MAX_INLINE_STANCES = 6;

function VideoRowThumb({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div
        aria-hidden
        className="flex h-14 w-24 shrink-0 items-center justify-center rounded bg-gradient-to-br from-muted to-muted/40 text-muted-foreground/60"
      >
        <Play className="h-5 w-5" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      className="h-14 w-24 shrink-0 rounded object-cover"
    />
  );
}

function VideoRow({
  video,
  checked,
  onToggle,
  onAct,
  busy,
  authenticated,
}: {
  video: ChannelVideoItem;
  checked: boolean;
  onToggle: () => void;
  onAct: (path: "analyze" | "skip", ids: string[]) => Promise<void>;
  busy: boolean;
  authenticated: boolean;
}) {
  const t = useTranslations("ChannelDetail");
  const actionable = ACTIONABLE.has(video.status);
  const action = rowActionKey(video.status);
  const visibleStances = video.stances.slice(0, MAX_INLINE_STANCES);
  const overflowStances = video.stances.length - visibleStances.length;

  return (
    <div className="group grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-3 rounded-md px-2 py-3 transition-colors hover:bg-muted/40">
      {authenticated ? (
        <input
          type="checkbox"
          className="mt-3 h-4 w-4 accent-primary disabled:opacity-30"
          checked={checked}
          onChange={onToggle}
          disabled={!actionable}
          aria-label={video.title}
        />
      ) : (
        <div aria-hidden className="mt-3 h-4 w-4" />
      )}
      <VideoRowThumb url={video.thumbnail_url} />

      {/* Main info column: title → time/status badges → stance chips */}
      <div className="min-w-0 space-y-1.5">
        <Link
          href={`/videos/${video.id}`}
          className="line-clamp-1 text-sm font-medium leading-snug hover:underline"
          title={video.title}
        >
          {video.title}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{formatDate(video.published_at)}</span>
          <span className="opacity-60">·</span>
          <Badge
            variant={BADGE_VARIANT[video.status]}
            className="h-5 px-1.5 text-[11px]"
            title={video.error_message ?? undefined}
          >
            {t(`videos.status.${video.status}`)}
          </Badge>
        </div>
        {visibleStances.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {visibleStances.map((s) => (
              <StanceBadge
                key={s.ticker}
                stance={s.stance}
                ticker={s.ticker}
                confidence={s.confidence}
              />
            ))}
            {overflowStances > 0 && (
              <span
                className="text-[11px] text-muted-foreground"
                title={video.stances
                  .slice(MAX_INLINE_STANCES)
                  .map((s) => s.ticker)
                  .join(", ")}
              >
                +{overflowStances}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Actions column: shown on hover on desktop; touch devices have no hover, so always visible */}
      <div className="flex shrink-0 items-center gap-0.5 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        {authenticated && action && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onAct("analyze", [video.id])}
          >
            {t(`videos.${action}`)}
          </Button>
        )}
        {authenticated && SKIPPABLE.has(video.status) && (
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
