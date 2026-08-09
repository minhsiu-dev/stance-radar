import type { FailureKind } from "@/lib/types";

export const FAILURES_PAGE_SIZE = 20;

export interface FailuresFilter {
  kind?: FailureKind;
  channelId?: string;
  maxAttempts?: number;
}

export function failuresSummaryKey(
  opts: { channelId?: string; maxAttempts?: number } = {},
): string {
  const qs = new URLSearchParams();
  if (opts.channelId) qs.set("channel_id", opts.channelId);
  if (opts.maxAttempts != null) {
    qs.set("max_attempts", String(opts.maxAttempts));
  }
  const query = qs.toString();
  return query ? `/api/videos/failures?${query}` : "/api/videos/failures";
}

export function failuresItemsKey(
  filter: FailuresFilter,
  page: number,
): string {
  const qs = new URLSearchParams();
  if (filter.kind) qs.set("kind", filter.kind);
  if (filter.channelId) qs.set("channel_id", filter.channelId);
  if (filter.maxAttempts != null) {
    qs.set("max_attempts", String(filter.maxAttempts));
  }
  qs.set("page", String(page));
  qs.set("page_size", String(FAILURES_PAGE_SIZE));
  return `/api/videos/failures/items?${qs.toString()}`;
}
