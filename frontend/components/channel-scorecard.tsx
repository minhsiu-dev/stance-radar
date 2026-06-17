"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScorecardTable } from "@/components/scorecard-table";
import type { Scorecard } from "@/lib/types";

const PAGE_SIZE = 20;

export function ChannelScorecard({ channelId }: { channelId: string }) {
  const t = useTranslations("Scorecard");
  const tStance = useTranslations("Stock.stance");
  const [stanceFilter, setStanceFilter] = useState<"all" | "buy" | "sell">("all");
  const [tickerFilter, setTickerFilter] = useState<string>("all");
  const getKey = useMemo(
    () => (pageIndex: number, previous: Scorecard | null) => {
      if (previous && previous.calls.length < PAGE_SIZE) return null;
      return (
        `/api/channels/${channelId}/scorecard?page=${pageIndex + 1}&page_size=${PAGE_SIZE}` +
        (stanceFilter === "all" ? "" : `&stance=${stanceFilter}`) +
        (tickerFilter === "all" ? "" : `&ticker=${tickerFilter}`)
      );
    },
    [channelId, stanceFilter, tickerFilter],
  );
  // Fetches historical candles for each stock, which is slow: don't auto-revalidate
  const { data, error, isLoading, setSize, isValidating } =
    useSWRInfinite<Scorecard>(getKey, {
      revalidateOnFocus: false,
      revalidateFirstPage: false,
      dedupingInterval: 10 * 60 * 1000,
    });

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pages = data ?? [];
  const calls = pages.flatMap((p) => p.calls);
  const last = pages[pages.length - 1];
  const reachedEnd = last ? last.calls.length < PAGE_SIZE : false;
  const horizons = pages[0]?.horizons ?? [30, 90];
  const benchmark = pages[0]?.benchmark ?? "";
  const tickers = pages[0]?.tickers ?? [];

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isValidating && !reachedEnd) {
          setSize((s) => s + 1);
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [setSize, isValidating, reachedEnd]);

  if (isLoading && calls.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <p className="text-xs text-muted-foreground">{t("loading")}</p>
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-500">
            {t("loadError", { message: error.message })}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="channel-scorecard">
      <CardHeader className="space-y-2">
        <div className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={stanceFilter}
              onValueChange={(v) => setStanceFilter((v as "all" | "buy" | "sell") ?? "all")}
            >
              <SelectTrigger className="w-28">
                <SelectValue placeholder={t("filter.stance")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filter.allStances")}</SelectItem>
                <SelectItem value="buy">{tStance("buy")}</SelectItem>
                <SelectItem value="sell">{tStance("sell")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={tickerFilter}
              onValueChange={(v) => setTickerFilter((v as string) ?? "all")}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder={t("filter.ticker")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filter.allTickers")}</SelectItem>
                {tickers.map((tk) => (
                  <SelectItem key={tk} value={tk}>
                    {tk}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("description", { benchmark })}
        </p>
      </CardHeader>
      <CardContent>
        {calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <ScorecardTable calls={calls} horizons={horizons} channelId={channelId} />
            {!reachedEnd && (
              <div ref={sentinelRef} data-testid="scorecard-sentinel" aria-hidden className="h-1" />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
