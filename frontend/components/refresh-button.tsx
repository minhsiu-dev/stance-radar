"use client";

import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { JobInfo } from "@/lib/types";

function progressLabel(job: JobInfo): string {
  const p = job.progress;
  if (p.stage === "listing") {
    return `頻道 ${p.channels_done ?? 0}/${p.channels_total ?? 0}`;
  }
  if (p.stage === "analyzing") {
    return `影片 ${p.videos_done ?? 0}/${p.videos_total ?? 0}`;
  }
  return "準備中…";
}

export function RefreshButton() {
  const { mutate } = useSWRConfig();
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const prevStatus = useRef<string | null>(null);

  const { data: job } = useSWR<JobInfo | null>("/api/jobs/current", apiFetch, {
    refreshInterval: (latest) => (latest?.status === "running" ? 2000 : 0),
    onSuccess: (latest) => {
      // running → done/failed 的瞬間,刷新 feed
      if (prevStatus.current === "running" && latest?.status !== "running") {
        mutate(
          (key) => typeof key === "string" && key.startsWith("/api/feed"),
        );
      }
      prevStatus.current = latest?.status ?? null;
    },
  });

  const running = job?.status === "running";

  async function trigger() {
    setTriggerError(null);
    try {
      await apiFetch("/api/refresh", { method: "POST" });
      await mutate("/api/jobs/current");
    } catch (error) {
      setTriggerError(error instanceof Error ? error.message : "更新失敗");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={trigger} disabled={running} size="sm">
        {running ? `更新中… ${progressLabel(job!)}` : "更新"}
      </Button>
      {triggerError && <p className="text-xs text-red-500">{triggerError}</p>}
      {!running && job?.status === "failed" && (
        <p className="text-xs text-red-500">上次更新失敗:{job.error_message}</p>
      )}
    </div>
  );
}
