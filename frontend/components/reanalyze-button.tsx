"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/components/admin-provider";
import { useAnalyzeJob } from "@/components/use-analyze-job";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Re-analyze this video: set it back to pending, trigger an analyze job, then wait for
 * that specific job id to finish and re-fetch the video detail via onDone.
 */
export function ReanalyzeButton({
  videoId,
  onDone,
}: {
  videoId: string;
  onDone: () => void;
}) {
  const t = useTranslations("VideoDetail");
  const { authenticated, handleAuthError } = useAdmin();
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { watch } = useAnalyzeJob(() => {
    setActive(false);
    onDone();
  });

  async function trigger() {
    setError(null);
    setActive(true);
    try {
      const res = await apiFetch<{ job_id: number; created: boolean }>(
        "/api/videos/analyze",
        { method: "POST", body: JSON.stringify({ video_ids: [videoId] }) },
      );
      watch(res.job_id);
    } catch (err) {
      setActive(false);
      handleAuthError(err);
      setError(err instanceof Error ? err.message : t("reanalyzeFailed"));
    }
  }

  if (!authenticated) return null;

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
