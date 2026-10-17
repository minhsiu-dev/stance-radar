"use client";

import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/components/admin-provider";
import { apiFetch } from "@/lib/api";
import { PIPELINE_KEY } from "@/lib/pipeline";
import type { JobInfo } from "@/lib/types";

const JOB_POLL_MS = 2000;

function progressLabel(
  job: JobInfo,
  t: ReturnType<typeof useTranslations<"Dashboard.refresh">>,
): string {
  const p = job.progress;
  if (p.stage === "listing") {
    return t("stages.listing", {
      done: p.channels_done ?? 0,
      total: p.channels_total ?? 0,
    });
  }
  return t("stages.preparing");
}

export function RefreshButton() {
  const t = useTranslations("Dashboard.refresh");
  const { mutate } = useSWRConfig();
  const { authenticated, handleAuthError } = useAdmin();
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [noNew, setNoNew] = useState(false);
  const prevStatus = useRef<string | null>(null);
  // A number in state, not a `(latest) => ...` function: SWR restarts its polling
  // timer whenever refreshInterval changes identity, and /pipeline re-renders every
  // second (useNow), so an inline function reset the 2s timer before it ever fired.
  const [pollMs, setPollMs] = useState(0);

  const { data: job } = useSWR<JobInfo | null>("/api/jobs/current", apiFetch, {
    refreshInterval: pollMs,
    onSuccess: (latest) => {
      setPollMs(latest?.status === "running" ? JOB_POLL_MS : 0);
      // The moment running → done/failed: refresh what the job changed. New videos
      // simply show up in the import inbox, so there is nothing to navigate to.
      if (prevStatus.current === "running" && latest?.status !== "running") {
        mutate(
          (key) =>
            typeof key === "string" &&
            (key.startsWith("/api/feed") ||
              key.startsWith("/api/videos") ||
              key.startsWith("/api/channels") ||
              key === PIPELINE_KEY),
        );
        if (
          latest?.status === "done" &&
          latest.kind === "discover" &&
          (latest.progress.discovered ?? 0) === 0
        ) {
          setNoNew(true);
        }
      }
      prevStatus.current = latest?.status ?? null;
    },
  });

  const running = job?.status === "running";

  async function trigger() {
    setTriggerError(null);
    setNoNew(false);
    try {
      await apiFetch("/api/refresh", { method: "POST" });
      await mutate("/api/jobs/current");
    } catch (error) {
      handleAuthError(error);
      setTriggerError(error instanceof Error ? error.message : t("triggerFailed"));
    }
  }

  if (!authenticated) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={trigger} disabled={running} size="sm">
        {running ? t("running", { stage: progressLabel(job!, t) }) : t("label")}
      </Button>
      {triggerError && <p className="text-xs text-red-500">{triggerError}</p>}
      {noNew && <p className="text-xs text-muted-foreground">{t("noNew")}</p>}
      {!running && job?.status === "failed" && (
        <p className="text-xs text-red-500">
          {t("lastFailed", { message: job.error_message ?? "" })}
        </p>
      )}
    </div>
  );
}
