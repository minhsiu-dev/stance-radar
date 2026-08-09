"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
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
import { useAdmin } from "@/components/admin-provider";
import { useAnalyzeJob } from "@/components/use-analyze-job";
import { FailedVideosList } from "@/components/failed-videos-list";
import { apiFetch } from "@/lib/api";
import { failuresSummaryKey, type FailuresFilter } from "@/lib/failures";
import type { FailureKind, FailuresSummary } from "@/lib/types";

const KINDS: FailureKind[] = ["transcript", "analysis"];
const THRESHOLDS = [2, 3, 5];

export function FailedVideos() {
  const t = useTranslations("Failed");
  const { mutate } = useSWRConfig();
  const { authenticated, handleAuthError } = useAdmin();
  const [channelId, setChannelId] = useState("all");
  const [threshold, setThreshold] = useState("all");
  const [expanded, setExpanded] = useState<FailureKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Bumped after every completed retry to remount the lists. SWR's filter-form
  // mutate skips useSWRInfinite's internal $inf$ keys, so a predicate can never
  // reach them — remounting is what actually re-fetches the rows.
  const [listTick, setListTick] = useState(0);

  const maxAttempts = threshold === "all" ? undefined : Number(threshold);
  // channel_id must be threaded through here too: the summary's group totals are
  // scoped to it server-side, and the retry button's label/action reads `retryable`
  // from this same response. Passing only maxAttempts would leave the button
  // showing a global count while the retry itself (and the item list) stay
  // channel-scoped -- "Retry this group (143)" queuing a different number.
  const { data, error } = useSWR<FailuresSummary>(
    failuresSummaryKey({
      channelId: channelId === "all" ? undefined : channelId,
      maxAttempts,
    }),
    // Changing either filter changes the key, which would otherwise blank `data`
    // for a tick and unmount the very Select the user just interacted with
    // (the same trap Correction 2 exists to avoid, here on a refetch rather
    // than an empty result).
    { keepPreviousData: true },
  );

  function refresh() {
    mutate(
      (key) => typeof key === "string" && key.startsWith("/api/videos/failures"),
    );
    setListTick((n) => n + 1);
  }

  const { job, running, watch } = useAnalyzeJob(() => refresh());

  function filterFor(kind: FailureKind): FailuresFilter {
    return {
      kind,
      channelId: channelId === "all" ? undefined : channelId,
      maxAttempts,
    };
  }

  async function retryGroup(kind: FailureKind) {
    setMessage(null);
    try {
      const res = await apiFetch<{
        queued: number;
        job_id: number | null;
        created: boolean;
      }>("/api/videos/failures/retry", {
        method: "POST",
        body: JSON.stringify({
          kind,
          channel_id: channelId === "all" ? null : channelId,
          max_attempts: maxAttempts ?? null,
        }),
      });
      if (res.job_id == null) {
        refresh();
        return;
      }
      if (!res.created) setMessage(t("job.queued"));
      watch(res.job_id);
    } catch (err) {
      handleAuthError(err);
      setMessage(
        t("retryFailed", { message: err instanceof Error ? err.message : "?" }),
      );
    }
  }

  async function retryOne(videoId: string) {
    setMessage(null);
    try {
      const res = await apiFetch<{ job_id: number; created: boolean }>(
        "/api/videos/analyze",
        { method: "POST", body: JSON.stringify({ video_ids: [videoId] }) },
      );
      if (!res.created) setMessage(t("job.queued"));
      watch(res.job_id);
    } catch (err) {
      handleAuthError(err);
      setMessage(
        t("retryFailed", { message: err instanceof Error ? err.message : "?" }),
      );
    }
  }

  function jobLine() {
    // /api/jobs/current returns the most recent job of ANY kind once nothing is
    // running (see backend/app/api/refresh.py) -- e.g. last night's scheduled
    // `discover` job. This line exists to report on a retry the user just
    // triggered, so a non-"analyze" job (nothing started here) must render
    // nothing rather than a fabricated status about an action they never took.
    if (!job || job.kind !== "analyze") return null;
    if (job.status === "running") {
      return (
        <p className="text-xs text-muted-foreground">
          {t("job.running", {
            done: job.progress.videos_done ?? 0,
            total: job.progress.videos_total ?? 0,
          })}
        </p>
      );
    }
    if (job.status === "failed") {
      return (
        <p className="text-xs text-red-500">
          {t("job.failed", { message: job.error_message ?? "" })}
        </p>
      );
    }
    if ((job.progress.videos_failed ?? 0) > 0) {
      return (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("job.partial", {
            failed: job.progress.videos_failed ?? 0,
            total: job.progress.videos_done ?? 0,
          })}
        </p>
      );
    }
    return null;
  }

  if (error) {
    return (
      <p className="text-sm text-red-500">
        {t("loadError", { message: error.message })}
      </p>
    );
  }
  if (!data) return <Skeleton className="h-48 w-full" />;

  // `total` is channel-scoped (see the useSWR call above), but `channels` always
  // lists every channel that has failures regardless of the current selection --
  // so a channel filter that happens to match nothing must NOT hide the controls
  // that would let the user pick a different one. Only the cards region below
  // reacts to the empty state; distinguish "nothing has failed anywhere" (the
  // "all channels" view) from "this filter matches nothing" so the wording
  // doesn't claim the whole app has no failures when another channel does.
  const isEmpty = data.total === 0;
  const emptyMessage =
    isEmpty && channelId !== "all" ? t("noneMatchFilter") : t("empty");

  // SelectValue only falls back to `placeholder` when the value is empty; "all"
  // is a real, non-empty value, so without explicit children base-ui renders
  // the raw value string (the literal "all", or a channel's raw id once
  // selected) instead of a translated label. Resolve both triggers' displayed
  // text explicitly, the same pattern feed-list.tsx uses for its channel filter.
  const channelTitle =
    channelId === "all"
      ? t("allChannels")
      : (data.channels.find((c) => c.id === channelId)?.title ?? channelId);
  const thresholdLabel =
    threshold === "all"
      ? t("thresholdAll")
      : t("thresholdUnder", { n: Number(threshold) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={channelId} onValueChange={(v) => setChannelId(v ?? "all")}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t("allChannels")}>{channelTitle}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allChannels")}</SelectItem>
            {data.channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {t("channelOption", { title: c.title, count: c.total })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={threshold} onValueChange={(v) => setThreshold(v ?? "all")}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("thresholdAll")}>{thresholdLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("thresholdAll")}</SelectItem>
            {THRESHOLDS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {t("thresholdUnder", { n })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {jobLine()}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      {isEmpty ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </CardContent>
        </Card>
      ) : (
        KINDS.map((kind) => {
          const group = data.groups.find((g) => g.kind === kind);
          if (!group || group.total === 0) return null;
          const open = expanded === kind;
          return (
            <Card key={kind}>
              <CardHeader className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {t(`kinds.${kind}.title`)}
                  </CardTitle>
                  <span className="text-sm text-muted-foreground">
                    {t("counts", {
                      total: group.total,
                      retryable: group.retryable,
                    })}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(`kinds.${kind}.description`)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {authenticated && (
                    <Button
                      size="sm"
                      disabled={running || group.retryable === 0}
                      onClick={() => retryGroup(kind)}
                    >
                      {t("retryGroup", { count: group.retryable })}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExpanded(open ? null : kind)}
                  >
                    {open ? t("collapse") : t("expand")}
                  </Button>
                </div>
              </CardHeader>
              {open && (
                <CardContent>
                  <FailedVideosList
                    key={`${kind}-${listTick}`}
                    filter={filterFor(kind)}
                    disabled={running}
                    onRetry={retryOne}
                  />
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
