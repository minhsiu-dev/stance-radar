"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { JobInfo } from "@/lib/types";

/**
 * Re-analyze this video: set it back to pending and trigger an analyze job, then poll
 * /api/jobs/current until "our job" finishes, then call onDone to re-fetch the video detail.
 * Comparing the job id (rather than just a running→done transition) is needed to cover the case
 * where, under the fake adapter, the job finishes instantly and is already done on the first poll.
 */
export function ReanalyzeButton({
  videoId,
  onDone,
}: {
  videoId: string;
  onDone: () => void;
}) {
  const t = useTranslations("VideoDetail");
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedJobId = useRef<number | null>(null);

  useSWR<JobInfo | null>(active ? "/api/jobs/current" : null, apiFetch, {
    refreshInterval: (latest) => (latest?.status === "running" ? 1500 : 0),
    onSuccess: (latest) => {
      if (
        startedJobId.current != null &&
        latest?.id === startedJobId.current &&
        latest.status !== "running"
      ) {
        startedJobId.current = null;
        setActive(false);
        onDone();
      }
    },
  });

  async function trigger() {
    setError(null);
    try {
      const res = await apiFetch<{ job_id: number; created: boolean }>(
        "/api/videos/analyze",
        { method: "POST", body: JSON.stringify({ video_ids: [videoId] }) },
      );
      startedJobId.current = res.job_id;
      setActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reanalyzeFailed"));
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={trigger} disabled={active} size="sm" variant="outline">
        <RefreshCw className={cn("h-3.5 w-3.5", active && "animate-spin")} />
        {active ? t("reanalyzing") : t("reanalyze")}
      </Button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
