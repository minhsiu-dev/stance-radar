"use client";

import { ChevronRight, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { LaneStatus } from "@/components/pipeline/lane-status";
import { PipelineVideoRow } from "@/components/pipeline/pipeline-video-row";
import { elapsedLabel, laneState, type LaneState } from "@/lib/pipeline";
import type { LaneName, PipelineLane, PipelineLaneStage } from "@/lib/types";
import { cn } from "@/lib/utils";

const BORDER: Record<LaneState, string> = {
  running: "",
  paused: "border-amber-500/60",
  offline: "border-red-500/60",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{children}</p>
  );
}

/** ② / ③: one pipeline lane — its health, what it is doing, what is next. */
export function LaneColumn({
  name,
  lane,
  stage,
  now,
  onChanged,
  onOpenFailed,
}: {
  name: LaneName;
  lane: PipelineLane;
  stage: PipelineLaneStage;
  now: number;
  onChanged: () => void;
  onOpenFailed: () => void;
}) {
  const t = useTranslations("Pipeline");
  const title = t(`lanes.${name}`);
  const total = stage.queued + stage.processing.length;
  const hidden = stage.queued - stage.next.length;

  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/30 p-3",
        BORDER[laneState(lane)],
      )}
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-2xl font-bold tabular-nums">{total}</span>
      </header>
      <LaneStatus name={name} lane={lane} now={now} onChanged={onChanged} />

      {stage.processing.length > 0 && (
        <div className="space-y-1">
          <SectionLabel>
            {t("column.processing")} ({stage.processing.length})
          </SectionLabel>
          {stage.processing.map((v) => (
            <PipelineVideoRow
              key={v.id}
              video={v}
              highlight
              meta={v.claimed_at ? elapsedLabel(v.claimed_at, now) : null}
            />
          ))}
        </div>
      )}

      {stage.next.length > 0 && (
        <div className="space-y-1">
          <SectionLabel>
            {t("column.queued")} ({stage.queued})
          </SectionLabel>
          {stage.next.map((v) => (
            <PipelineVideoRow key={v.id} video={v} />
          ))}
          {hidden > 0 && (
            <p className="text-center text-[11px] text-muted-foreground">
              {t("column.more", { count: hidden })}
            </p>
          )}
        </div>
      )}

      {total === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">{t("column.idle")}</p>
      )}

      {stage.failed > 0 && (
        <button
          type="button"
          onClick={onOpenFailed}
          className="mt-auto flex items-center justify-between rounded-md border border-red-500/40 bg-red-500/5 px-2 py-1.5 text-xs text-red-700 hover:bg-red-500/10 dark:text-red-300"
        >
          <span className="flex items-center gap-1">
            <XCircle className="size-3.5" />
            {t("column.failed", { count: stage.failed })}
          </span>
          <ChevronRight className="size-3.5" />
        </button>
      )}
    </section>
  );
}
