"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/components/admin-provider";
import { apiFetch } from "@/lib/api";
import { PIPELINE_KEY } from "@/lib/pipeline";
import type { PipelineSnapshot, VideoDetailResponse, VideoStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const FINAL: ReadonlySet<VideoStatus> = new Set(["analyzed", "failed", "no_transcript"]);

type Phase = "idle" | "submitting" | "watching";

/**
 * Re-analyze this video: route it back into the pipeline, then follow its own status
 * until a lane finishes with it and re-fetch the page via onDone. The watch uses its
 * own SWR key (?watch=1) so polling never fights the page's cached detail.
 */
export function ReanalyzeButton({
  videoId,
  onDone,
  pollMs = 2000,
}: {
  videoId: string;
  onDone: () => void;
  pollMs?: number;
}) {
  const t = useTranslations("VideoDetail");
  const { authenticated, handleAuthError } = useAdmin();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const watching = phase === "watching";

  const { data: watched } = useSWR<VideoDetailResponse>(
    watching ? `/api/videos/${videoId}?watch=1` : null,
    {
      refreshInterval: pollMs,
      onSuccess: (latest) => {
        if (FINAL.has(latest.video.status)) {
          setPhase("idle");
          onDone();
        }
      },
    },
  );
  const { data: pipeline } = useSWR<PipelineSnapshot>(watching ? PIPELINE_KEY : null, {
    refreshInterval: pollMs,
  });

  async function trigger() {
    setError(null);
    setPhase("submitting");
    try {
      await apiFetch("/api/videos/analyze", {
        method: "POST",
        body: JSON.stringify({ video_ids: [videoId] }),
      });
      setPhase("watching");
    } catch (err) {
      setPhase("idle");
      handleAuthError(err);
      setError(err instanceof Error ? err.message : t("reanalyzeFailed"));
    }
  }

  if (!authenticated) return null;

  const status = watched?.video.status;
  const processing = watched?.video.claimed === true;
  // pending waits on the transcript lane, transcribed on the analysis lane
  const waitingOn = status === "pending" ? "transcript" : "analysis";
  const lanePaused =
    watching && !processing && pipeline?.lanes[waitingOn].paused === true;
  const label =
    phase === "idle" ? t("reanalyze") : processing ? t("reanalyzing") : t("reanalyzeQueued");

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={trigger} disabled={phase !== "idle"} size="sm" variant="outline">
        <RefreshCw className={cn("h-3.5 w-3.5", phase !== "idle" && "animate-spin")} />
        {label}
      </Button>
      {lanePaused && <p className="text-xs text-amber-600 dark:text-amber-400">{t("reanalyzePaused")}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
