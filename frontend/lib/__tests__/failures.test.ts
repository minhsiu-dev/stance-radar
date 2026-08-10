import { describe, expect, it } from "vitest";
import {
  FAILURES_PAGE_SIZE,
  failuresItemsKey,
  failuresSummaryKey,
} from "@/lib/failures";

describe("failuresSummaryKey", () => {
  it("omits the query string entirely when there are no options", () => {
    expect(failuresSummaryKey()).toBe("/api/videos/failures");
  });

  it("carries the threshold", () => {
    expect(failuresSummaryKey({ maxAttempts: 3 })).toBe(
      "/api/videos/failures?max_attempts=3",
    );
  });

  it("carries the channel filter", () => {
    expect(failuresSummaryKey({ channelId: "UC_x" })).toBe(
      "/api/videos/failures?channel_id=UC_x",
    );
  });

  it("carries both, channel_id before max_attempts", () => {
    expect(
      failuresSummaryKey({ channelId: "UC_x", maxAttempts: 3 }),
    ).toBe("/api/videos/failures?channel_id=UC_x&max_attempts=3");
  });
});

describe("failuresItemsKey", () => {
  it("always pins page and page_size", () => {
    expect(failuresItemsKey({}, 1)).toBe(
      `/api/videos/failures/items?page=1&page_size=${FAILURES_PAGE_SIZE}`,
    );
  });

  it("includes every supplied filter", () => {
    expect(
      failuresItemsKey(
        { kind: "transcript", channelId: "UC_x", maxAttempts: 5 },
        2,
      ),
    ).toBe(
      "/api/videos/failures/items?kind=transcript&channel_id=UC_x" +
        `&max_attempts=5&page=2&page_size=${FAILURES_PAGE_SIZE}`,
    );
  });

  it("changes when only the threshold changes", () => {
    const a = failuresItemsKey({ kind: "analysis" }, 1);
    const b = failuresItemsKey({ kind: "analysis", maxAttempts: 3 }, 1);
    expect(a).not.toBe(b);
  });
});
