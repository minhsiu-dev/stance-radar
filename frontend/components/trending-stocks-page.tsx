"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { StockCard } from "@/components/stock-card";
import { useAdmin } from "@/components/admin-provider";
import { HoldingsDialog } from "@/components/holdings-dialog";
import { maxBucketTotal } from "@/lib/stance-buckets";
import { useSparklines } from "@/lib/use-sparklines";
import type { TrendingStock } from "@/lib/types";

const WINDOWS = [
  { days: 7, key: "week" },
  { days: 30, key: "month" },
  { days: 90, key: "quarter" },
] as const;

// Minimum distinct-channel count. The old 2-3 / 4-6 / 7+ bands existed because the
// ranking was hard-wired to channel count, so browsing by band was the only way to
// see anything but the top. With score ordering an upper bound has no purpose.
const MIN_CHANNELS = {
  all: { key: "minAll" },
  min2: { key: "min2", min: 2 },
  min3: { key: "min3", min: 3 },
  min5: { key: "min5", min: 5 },
} as const;

type MinChannelsKey = keyof typeof MIN_CHANNELS;

export function minChannelsParam(value: MinChannelsKey): string {
  const band = MIN_CHANNELS[value];
  return "min" in band ? `&min_channels=${band.min}` : "";
}

const PAGE_SIZE = 20;

export function TrendingStocksPage() {
  const t = useTranslations("Trending");
  const { authenticated } = useAdmin();
  const [fresh, setFresh] = useState(30);
  const [count, setCount] = useState(90);
  const [minChannels, setMinChannels] = useState<MinChannelsKey>("all");
  const [weighted, setWeighted] = useState(true);
  const [excludeHeld, setExcludeHeld] = useState(false);

  // Infinite scroll: fetch the ranked list PAGE_SIZE at a time via offset pagination.
  // A short page (< PAGE_SIZE) means we've reached the end, so getKey returns null.
  const getKey = useCallback(
    (pageIndex: number, previous: TrendingStock[] | null) => {
      if (previous && previous.length < PAGE_SIZE) return null;
      const url = `/api/stocks/trending?limit=${PAGE_SIZE}&offset=${pageIndex * PAGE_SIZE}&days=${fresh}&count_days=${count}&sort=score`;
      return (
        url +
        minChannelsParam(minChannels) +
        (weighted ? "" : "&weighted=false") +
        (authenticated && excludeHeld ? "&exclude_held=true" : "")
      );
    },
    [fresh, count, minChannels, weighted, authenticated, excludeHeld],
  );
  const { data: pages, isLoading, setSize, mutate: revalidatePages } =
    useSWRInfinite<TrendingStock[]>(getKey);

  // Reset to the first page when the filters change.
  useEffect(() => {
    setSize(1);
  }, [fresh, count, minChannels, weighted, excludeHeld, setSize]);

  // HoldingsDialog can't reach this hook's $inf$-prefixed cache key through the global
  // filter-mutate (SWR skips $inf$/$sub$ keys before the predicate ever runs), so it fires
  // this window event instead; revalidate every currently loaded page in response. Mirrors
  // channel-manager.tsx's "channels:changed" listener for add-channel-dialog.tsx.
  useEffect(() => {
    const handler = () => revalidatePages();
    window.addEventListener("holdings:changed", handler);
    return () => window.removeEventListener("holdings:changed", handler);
  }, [revalidatePages]);

  const items = (pages ?? []).flat();
  const yMax = maxBucketTotal(items);
  const tickerPages = useMemo(
    () => (pages ?? []).map((p) => p.map((s) => s.ticker)),
    [pages],
  );
  const sparklines = useSparklines(tickerPages, count);
  const lastPage = pages?.[pages.length - 1];
  const hasMore = !!lastPage && lastPage.length === PAGE_SIZE;

  // Load the next page when the sentinel scrolls into view.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) setSize((s) => s + 1);
        },
        { rootMargin: "300px" },
      );
      obs.observe(node);
      observerRef.current = obs;
    },
    [setSize],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">{t("title")}</h2>
        <div className="flex flex-wrap gap-4">
          <WindowSelect label={t("freshness")} value={fresh} onChange={setFresh} t={t} />
          <WindowSelect label={t("countWindow")} value={count} onChange={setCount} t={t} />
          <MinChannelsSelect
            label={t("minChannels")}
            value={minChannels}
            onChange={setMinChannels}
            t={t}
          />
          {/* No aria-label here: Base UI's Switch.Root auto-detects the wrapping
              <label> and points aria-labelledby at it, which already supplies the
              accessible name from this text node. Adding a redundant aria-label
              with the same string doubles the computed name ("Weight by win
              rateWeight by win rate" per the ARIA accname algorithm), which then
              fails an exact-match `getByRole(..., { name })` lookup. */}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("weighted")}
            <Switch checked={weighted} onCheckedChange={setWeighted} className="mt-1" />
          </label>
          {authenticated && (
            <div className="flex items-end gap-1">
              {/* No aria-label here either, for the same reason as the weighted
                  switch above: the wrapping <label> already supplies the
                  accessible name. */}
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("excludeHeld")}
                <Switch checked={excludeHeld} onCheckedChange={setExcludeHeld} className="mt-1" />
              </label>
              <HoldingsDialog />
            </div>
          )}
        </div>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
        </div>
      ) : items.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((s) => (
              <StockCard key={s.ticker} s={s} yMax={yMax} closes={sparklines[s.ticker]} showScore />
            ))}
          </div>
          {hasMore && <div ref={sentinelRef} data-testid="trending-load-more" className="h-4" />}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </div>
  );
}

function WindowSelect({
  label,
  value,
  onChange,
  t,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  t: ReturnType<typeof useTranslations<"Trending">>;
}) {
  const current = WINDOWS.find((w) => w.days === value);
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="w-28">
          <SelectValue>{current ? t(current.key) : ""}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {WINDOWS.map((w) => (
            <SelectItem key={w.days} value={String(w.days)}>
              {t(w.key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function MinChannelsSelect({
  label,
  value,
  onChange,
  t,
}: {
  label: string;
  value: MinChannelsKey;
  onChange: (v: MinChannelsKey) => void;
  t: ReturnType<typeof useTranslations<"Trending">>;
}) {
  const keys = Object.keys(MIN_CHANNELS) as MinChannelsKey[];
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select value={value} onValueChange={(v) => onChange(v as MinChannelsKey)}>
        <SelectTrigger className="w-28">
          <SelectValue>{t(MIN_CHANNELS[value].key)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {keys.map((k) => (
            <SelectItem key={k} value={k}>
              {t(MIN_CHANNELS[k].key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
