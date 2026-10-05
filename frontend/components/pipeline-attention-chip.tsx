"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useAdmin } from "@/components/admin-provider";
import { LANE_NAMES, PIPELINE_KEY, laneState, needsAttention } from "@/lib/pipeline";
import type { PipelineSnapshot } from "@/lib/types";

/** Admin-only nudge on /videos and /channels; silent when the pipeline needs nothing. */
export function PipelineAttentionChip() {
  const t = useTranslations("Pipeline.chip");
  const tLane = useTranslations("Pipeline.laneShort");
  const { authenticated } = useAdmin();
  const { data } = useSWR<PipelineSnapshot>(authenticated ? PIPELINE_KEY : null, {
    refreshInterval: 30_000,
  });
  if (!authenticated || !data || !needsAttention(data)) return null;

  const parts: string[] = [];
  if (data.stages.select.total > 0) {
    parts.push(t("pending", { count: data.stages.select.total }));
  }
  const failed = data.stages.transcript.failed + data.stages.analysis.failed;
  if (failed > 0) parts.push(t("failed", { count: failed }));
  for (const name of LANE_NAMES) {
    const state = laneState(data.lanes[name]);
    if (state !== "running") parts.push(t(state, { lane: tLane(name) }));
  }

  return (
    <Link
      href="/pipeline"
      className="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
    >
      <Inbox className="h-3.5 w-3.5" />
      {t("label")}: {parts.join(" · ")}
    </Link>
  );
}
