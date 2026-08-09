"use client";

import { useCallback, useRef, useState } from "react";
import useSWR from "swr";
import type { JobInfo } from "@/lib/types";

/**
 * The app runs a single global job at a time. This subscribes to it so callers can
 * (a) disable their controls whenever anything is running and (b) `watch(jobId)` a
 * job they just started and be called back when it finishes.
 *
 * Comparing the job id — rather than watching a running→done transition — covers the
 * case where, under the fake adapter, the job finishes instantly and is already `done`
 * on the very first poll.
 *
 * No explicit fetcher: SWRProvider supplies `apiFetch` globally, which keeps this
 * mockable through a single SWRConfig fetcher in tests.
 */
export function useAnalyzeJob(onFinished?: () => void) {
  const [watching, setWatching] = useState(false);
  const watchedId = useRef<number | null>(null);

  const { data: job, mutate: revalidate } = useSWR<JobInfo | null>("/api/jobs/current", {
    refreshInterval: (latest) =>
      latest?.status === "running" || watching ? 1500 : 0,
    onSuccess: (latest) => {
      if (
        watchedId.current != null &&
        latest?.id === watchedId.current &&
        latest.status !== "running"
      ) {
        watchedId.current = null;
        setWatching(false);
        onFinished?.();
      }
    },
  });

  const watch = useCallback(
    (jobId: number) => {
      watchedId.current = jobId;
      setWatching(true);
      // Revalidate straight away rather than waiting out the 1500ms interval: under the
      // fake adapter the job is often already `done` by the time we get here, and a
      // caller that has to wait a full tick for its callback reads as a hung button.
      void revalidate();
    },
    [revalidate],
  );

  return { job, running: job?.status === "running" || watching, watch };
}
