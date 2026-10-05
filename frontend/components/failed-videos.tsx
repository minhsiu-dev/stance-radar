"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdmin } from "@/components/admin-provider";
import { FailedVideosList } from "@/components/failed-videos-list";
import { apiFetch } from "@/lib/api";
import { failuresSummaryKey, type FailuresFilter } from "@/lib/failures";
import { PIPELINE_KEY } from "@/lib/pipeline";
import type { FailureKind, FailuresSummary } from "@/lib/types";

const THRESHOLDS = [2, 3, 5];

/** Failed videos of one kind (= the lane they died in), with filters and retries.
 *  Lives in the import page's failure drawer. */
export function FailedVideos({ kind }: { kind: FailureKind }) {
  const t = useTranslations("Failed");
  const { mutate } = useSWRConfig();
  const { authenticated, handleAuthError } = useAdmin();
  const [channelId, setChannelId] = useState("all");
  const [threshold, setThreshold] = useState("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Bumped after every retry to remount the list. SWR's filter-form mutate skips
  // useSWRInfinite's internal $inf$ keys, so a predicate can never reach them —
  // remounting is what actually re-fetches the rows.
  const [listTick, setListTick] = useState(0);

  const maxAttempts = threshold === "all" ? undefined : Number(threshold);
  const scopedChannel = channelId === "all" ? undefined : channelId;
  // channel_id is threaded through so the group totals, the retry button's count and
  // the list all describe the same subset.
  const { data, error } = useSWR<FailuresSummary>(
    failuresSummaryKey({ channelId: scopedChannel, maxAttempts }),
    // Changing a filter changes the key; keep the old data so the Select the user
    // just touched doesn't unmount for a tick.
    { keepPreviousData: true },
  );

  function refresh() {
    void mutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/videos/failures") || key === PIPELINE_KEY),
    );
    setListTick((n) => n + 1);
  }

  async function run(request: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await request();
      refresh();
    } catch (err) {
      handleAuthError(err);
      setMessage(t("retryFailed", { message: err instanceof Error ? err.message : "?" }));
    } finally {
      setBusy(false);
    }
  }

  const retryGroup = () =>
    run(() =>
      apiFetch("/api/videos/failures/retry", {
        method: "POST",
        body: JSON.stringify({
          kind,
          channel_id: scopedChannel ?? null,
          max_attempts: maxAttempts ?? null,
        }),
      }),
    );

  const retryOne = (videoId: string) =>
    run(() =>
      apiFetch("/api/videos/analyze", {
        method: "POST",
        body: JSON.stringify({ video_ids: [videoId] }),
      }),
    );

  if (error) {
    return <p className="text-sm text-red-500">{t("loadError", { message: error.message })}</p>;
  }
  if (!data) return <Skeleton className="h-48 w-full" />;

  const group = data.groups.find((g) => g.kind === kind) ?? { kind, total: 0, retryable: 0 };
  const filter: FailuresFilter = { kind, channelId: scopedChannel, maxAttempts };
  const channelTitle =
    channelId === "all"
      ? t("allChannels")
      : (data.channels.find((c) => c.id === channelId)?.title ?? channelId);
  const thresholdLabel =
    threshold === "all" ? t("thresholdAll") : t("thresholdUnder", { n: Number(threshold) });

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t(`kinds.${kind}.description`)}</p>
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

      {group.total === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {channelId === "all" ? t("empty") : t("noneMatchFilter")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {t("counts", { total: group.total, retryable: group.retryable })}
            </span>
            {authenticated && (
              <Button size="sm" disabled={busy || group.retryable === 0} onClick={retryGroup}>
                {t("retryGroup", { count: group.retryable })}
              </Button>
            )}
          </div>
          {message && <p className="text-xs text-red-500">{message}</p>}
          <FailedVideosList
            key={`${kind}-${listTick}`}
            filter={filter}
            disabled={busy}
            onRetry={retryOne}
          />
        </>
      )}
    </div>
  );
}
