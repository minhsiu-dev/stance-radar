"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/components/admin-provider";
import { apiFetch } from "@/lib/api";
import { elapsedLabel, laneState, minutesSince, type LaneState } from "@/lib/pipeline";
import type { LaneName, PipelineLane, UsageWindow } from "@/lib/types";
import { cn } from "@/lib/utils";

const DOT: Record<LaneState, string> = {
  running: "bg-emerald-500",
  paused: "bg-amber-500",
  offline: "bg-red-500",
};

function percent(window: UsageWindow | null): string {
  return window ? String(Math.round(window.utilization * 100)) : "–";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local "HH:mm", with "M/d " in front when it isn't on `now`'s day. */
function resumeLabel(resumeAt: string, now: number): string {
  const at = new Date(resumeAt);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return at.toDateString() === new Date(now).toDateString()
    ? time
    : `${at.getMonth() + 1}/${at.getDate()} ${time}`;
}

export function LaneStatus({
  name,
  lane,
  now,
  onChanged,
}: {
  name: LaneName;
  lane: PipelineLane;
  now: number;
  onChanged: () => void;
}) {
  const t = useTranslations("Pipeline.status");
  const { handleAuthError } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = laneState(lane);
  const minutes = minutesSince(lane.last_heartbeat_at, now);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/pipeline/lanes/${name}/${lane.paused ? "resume" : "pause"}`, {
        method: "POST",
      });
      onChanged();
    } catch (err) {
      handleAuthError(err);
      setError(t("actionFailed", { message: err instanceof Error ? err.message : "?" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2 rounded-full", DOT[state])} />
          {state === "running" ? t("running", { slots: lane.concurrency ?? 0 }) : t(state)}
        </span>
        {/* An offline worker can't act on a pause flag; don't offer one. */}
        {state !== "offline" && (
          <Button
            size="xs"
            variant={lane.paused ? "default" : "outline"}
            disabled={busy}
            onClick={toggle}
          >
            {lane.paused ? t("resume") : t("pause")}
          </Button>
        )}
      </div>
      {lane.usage && (
        <p className="text-xs text-muted-foreground">
          {t("usage", {
            fiveHour: percent(lane.usage.five_hour),
            sevenDay: percent(lane.usage.seven_day),
          })}
        </p>
      )}
      {state === "paused" && lane.pause_reason === "limit" && (
        <div
          role="alert"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-xs"
        >
          <p className="font-medium">
            {t("limitPaused", { time: lane.resume_at ? resumeLabel(lane.resume_at, now) : "?" })}
          </p>
          {lane.last_error && (
            <p className="mt-0.5 break-words font-mono text-[11px]">{lane.last_error}</p>
          )}
        </div>
      )}
      {state === "paused" && lane.pause_reason === "auto" && (
        <div
          role="alert"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-xs"
        >
          <p className="font-medium">
            {t("autoPaused")}
            {lane.last_error_at && ` · ${t("ago", { time: elapsedLabel(lane.last_error_at, now) })}`}
          </p>
          {lane.last_error && (
            <p className="mt-0.5 break-words font-mono text-[11px]">{lane.last_error}</p>
          )}
        </div>
      )}
      {state === "offline" && (
        <div
          role="alert"
          className="rounded-md border border-red-500/50 bg-red-500/10 px-2 py-1.5 text-xs"
        >
          <p className="font-medium">
            {minutes == null ? t("offlineNever") : t("offlineSince", { minutes })}
          </p>
          {lane.last_error && (
            <p className="mt-0.5 break-words font-mono text-[11px]">
              {t("lastError", { message: lane.last_error })}
            </p>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
