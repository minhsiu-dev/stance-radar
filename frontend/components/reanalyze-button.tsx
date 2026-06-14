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
 * 重新分析這一部影片:把它設回 pending 並觸發 analyze job,然後輪詢
 * /api/jobs/current,直到「我們這支 job」結束,再呼叫 onDone 重抓影片詳情。
 * 比對 job id(而非單純 running→done 轉換)才能涵蓋假 adapter 下 job 秒殺、
 * 第一次輪詢就已 done 的情況。
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
