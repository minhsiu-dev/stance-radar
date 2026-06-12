"use client";

import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { JobInfo } from "@/lib/types";

function progressLabel(job: JobInfo, t: ReturnType<typeof useTranslations<"Dashboard.refresh">>): string {
  const p = job.progress;
  if (p.stage === "listing") {
    return t("stages.listing", { done: p.channels_done ?? 0, total: p.channels_total ?? 0 });
  }
  if (p.stage === "analyzing") {
    return t("stages.analyzing", { done: p.videos_done ?? 0, total: p.videos_total ?? 0 });
  }
  return t("stages.preparing");
}

export function RefreshButton() {
  const t = useTranslations("Dashboard.refresh");
  const { mutate } = useSWRConfig();
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const prevStatus = useRef<string | null>(null);

  const { data: job } = useSWR<JobInfo | null>("/api/jobs/current", apiFetch, {
    refreshInterval: (latest) => (latest?.status === "running" ? 2000 : 0),
    onSuccess: (latest) => {
      // running → done/failed transition, refresh feed
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
      setTriggerError(error instanceof Error ? error.message : t("triggerFailed"));
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={trigger} disabled={running} size="sm">
        {running ? t("running", { stage: progressLabel(job!, t) }) : t("label")}
      </Button>
      {triggerError && <p className="text-xs text-red-500">{triggerError}</p>}
      {!running && job?.status === "failed" && (
        <p className="text-xs text-red-500">
          {t("lastFailed", { message: job.error_message ?? "" })}
        </p>
      )}
    </div>
  );
}
