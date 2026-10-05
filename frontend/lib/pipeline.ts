import type { LaneName, PipelineLane, PipelineSnapshot } from "@/lib/types";

export const PIPELINE_KEY = "/api/pipeline";
export const PIPELINE_POLL_MS = 3000;
export const LANE_NAMES: readonly LaneName[] = ["transcript", "analysis"];

export type LaneState = "running" | "paused" | "offline";

/** Offline wins: a paused lane whose worker is gone can't be resumed from here. */
export function laneState(lane: PipelineLane): LaneState {
  if (!lane.online) return "offline";
  return lane.paused ? "paused" : "running";
}

/** True when the import page has something for the operator to act on. */
export function needsAttention(snapshot: PipelineSnapshot): boolean {
  const { stages, lanes } = snapshot;
  return (
    stages.select.total > 0 ||
    stages.transcript.failed + stages.analysis.failed > 0 ||
    LANE_NAMES.some((name) => laneState(lanes[name]) !== "running")
  );
}

/** "4s", "1m12s", "1h3m" since `fromIso`. Clamps to "0s" when the server's clock
 *  runs ahead of the browser's. */
export function elapsedLabel(fromIso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

/** Whole minutes since `iso`, or null when there is no timestamp at all. */
export function minutesSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60_000));
}
