import en from "@/messages/en.json";
import type {
  PipelineDoneVideo,
  PipelineLane,
  PipelineLaneStage,
  PipelineSnapshot,
  PipelineVideo,
} from "@/lib/types";

/** Real English strings: a missing key fails the test instead of hiding behind a copy. */
export const messages = { Pipeline: en.Pipeline, Failed: en.Failed };

export const NOW = Date.parse("2026-10-04T12:00:00Z");
export const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

export function lane(over: Partial<PipelineLane> = {}): PipelineLane {
  return {
    paused: false,
    pause_reason: null,
    online: true,
    concurrency: 5,
    consecutive_failures: 0,
    last_error: null,
    last_error_at: null,
    last_heartbeat_at: iso(2_000),
    ...over,
  };
}

export function video(id: string, over: Partial<PipelineVideo> = {}): PipelineVideo {
  return {
    id,
    title: `Video ${id}`,
    thumbnail_url: "",
    channel: { id: "ch", title: "Alpha" },
    published_at: "2026-10-01T00:00:00Z",
    duration_seconds: 600,
    claimed_at: null,
    ...over,
  };
}

export function doneVideo(
  id: string,
  over: Partial<PipelineDoneVideo> = {},
): PipelineDoneVideo {
  return {
    ...video(id),
    status: "analyzed",
    finished_at: iso(60_000),
    stances: [],
    ...over,
  };
}

export function stage(over: Partial<PipelineLaneStage> = {}): PipelineLaneStage {
  return { queued: 0, failed: 0, processing: [], next: [], ...over };
}

export function snapshot(
  over: {
    select?: number;
    transcript?: Partial<PipelineLaneStage>;
    analysis?: Partial<PipelineLaneStage>;
    done?: PipelineSnapshot["stages"]["done"];
    lanes?: Partial<Record<"transcript" | "analysis", Partial<PipelineLane>>>;
  } = {},
): PipelineSnapshot {
  return {
    lanes: {
      transcript: lane({ concurrency: 1, ...over.lanes?.transcript }),
      analysis: lane(over.lanes?.analysis),
    },
    stages: {
      select: { total: over.select ?? 0 },
      transcript: stage(over.transcript),
      analysis: stage(over.analysis),
      done: over.done ?? { total: 0, items: [] },
    },
  };
}
