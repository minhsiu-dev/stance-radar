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
import { Skeleton } from "@/components/ui/skeleton";
import { StockCard } from "@/components/stock-card";
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
  const [fresh, setFresh] = useState(30);
  const [count, setCount] = useState(90);
  const [minChannels, setMinChannels] = useState<MinChannelsKey>("all");

  // Infinite scroll: fetch the ranked list PAGE_SIZE at a time via offset pagination.
  // A short page (< PAGE_SIZE) means we've reached the end, so getKey returns null.
  const getKey = useCallback(
    (pageIndex: number, previous: TrendingStock[] | null) => {
      if (previous && previous.length < PAGE_SIZE) return null;
      const url = `/api/stocks/trending?limit=${PAGE_SIZE}&offset=${pageIndex * PAGE_SIZE}&days=${fresh}&count_days=${count}&sort=score`;
      return url + minChannelsParam(minChannels);
    },
    [fresh, count, minChannels],
  );
  const { data: pages, isLoading, setSize } = useSWRInfinite<TrendingStock[]>(getKey);

  // Reset to the first page when the filters change.
  useEffect(() => {
    setSize(1);
  }, [fresh, count, minChannels, setSize]);

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
              <StockCard key={s.ticker} s={s} yMax={yMax} closes={sparklines[s.ticker]} />
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
