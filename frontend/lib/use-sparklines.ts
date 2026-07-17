"use client";

import { useEffect, useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import type { SparklinesResponse } from "@/lib/types";

// One batched sparklines request per loaded page of trending cards, merged
// into a single ticker -> closes map. Price data is decorative: a failed fetch
// leaves `data` unchanged (or empty on first load) — affected cards just
// render without a line.
export function useSparklines(
  tickerPages: string[][],
  days: number,
): SparklinesResponse {
  const getKey = (index: number) => {
    const page = tickerPages[index];
    if (!page || page.length === 0) return null;
    return `/api/stocks/sparklines?tickers=${page.join(",")}&days=${days}`;
  };
  const { data, setSize } = useSWRInfinite<SparklinesResponse>(getKey, {
    revalidateFirstPage: false,
  });
  useEffect(() => {
    setSize(Math.max(tickerPages.length, 1));
  }, [tickerPages.length, setSize]);
  return useMemo(
    () => Object.assign({}, ...(data ?? []).filter(Boolean)) as SparklinesResponse,
    [data],
  );
}
