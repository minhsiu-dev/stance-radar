import { describe, expect, it } from "vitest";
import { elapsedLabel, laneState, minutesSince, needsAttention } from "@/lib/pipeline";
import { lane, snapshot } from "@/components/__tests__/pipeline-fixtures";

describe("laneState", () => {
  it("is running when online and not paused", () => {
    expect(laneState(lane())).toBe("running");
  });
  it("is paused when online and paused", () => {
    expect(laneState(lane({ paused: true }))).toBe("paused");
  });
  it("is offline whenever the heartbeat is stale, paused or not", () => {
    expect(laneState(lane({ online: false }))).toBe("offline");
    expect(laneState(lane({ online: false, paused: true }))).toBe("offline");
  });
});

describe("needsAttention", () => {
  it("is quiet when nothing needs the operator", () => {
    expect(needsAttention(snapshot())).toBe(false);
  });
  it("flags videos waiting for a decision", () => {
    expect(needsAttention(snapshot({ select: 3 }))).toBe(true);
  });
  it("flags failures in either lane", () => {
    expect(needsAttention(snapshot({ transcript: { failed: 1 } }))).toBe(true);
    expect(needsAttention(snapshot({ analysis: { failed: 1 } }))).toBe(true);
  });
  it("flags a paused or offline lane", () => {
    expect(needsAttention(snapshot({ lanes: { analysis: { paused: true } } }))).toBe(true);
    expect(needsAttention(snapshot({ lanes: { transcript: { online: false } } }))).toBe(true);
  });
  it("does not flag queued work that is simply flowing", () => {
    expect(needsAttention(snapshot({ transcript: { queued: 40 } }))).toBe(false);
  });
});

describe("elapsedLabel", () => {
  const start = "2026-10-04T00:00:00Z";
  const at = (seconds: number) => Date.parse(start) + seconds * 1000;

  it("counts seconds, then minutes and seconds, then hours and minutes", () => {
    expect(elapsedLabel(start, at(4))).toBe("4s");
    expect(elapsedLabel(start, at(72))).toBe("1m12s");
    expect(elapsedLabel(start, at(3780))).toBe("1h3m");
  });
  it("elapsedLabel clamps a future timestamp to 0s", () => {
    expect(elapsedLabel(start, at(-3))).toBe("0s");
  });
});

describe("minutesSince", () => {
  it("is null when there was never a heartbeat", () => {
    expect(minutesSince(null, Date.now())).toBeNull();
  });
  it("floors to whole minutes", () => {
    expect(
      minutesSince("2026-10-04T00:00:00Z", Date.parse("2026-10-04T00:03:59Z")),
    ).toBe(3);
  });
});
