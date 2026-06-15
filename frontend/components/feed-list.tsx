"use client";

import { useEffect, useMemo, useRef } from "react";
import { Link } from "@/i18n/navigation";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { VideoCard } from "@/components/video-card";
import type {
  ChannelItem,
  FeedResponse,
  HoldingsResponse,
  StanceValue,
  StockListItem,
} from "@/lib/types";

const PAGE_SIZE = 20;

export interface FeedFilters {
  channelId: string;
  tickers: string[];
  stance: StanceValue | "all";
  holdingsOnly: boolean;
}

export const NO_FILTERS: FeedFilters = { channelId: "all", tickers: [], stance: "all", holdingsOnly: false };

export function toggleTicker(tickers: string[], ticker: string): string[] {
  return tickers.includes(ticker)
    ? tickers.filter((t) => t !== ticker)
    : [...tickers, ticker];
}

function feedQuery(page: number, filters: FeedFilters): string {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
  });
  if (filters.channelId !== "all") params.set("channel_id", filters.channelId);
  for (const tk of filters.tickers) params.append("ticker", tk);
  if (filters.stance !== "all") params.set("stance", filters.stance);
  if (filters.holdingsOnly) params.set("holdings_only", "true");
  return `/api/feed?${params.toString()}`;
}

function FeedFilterBar({
  filters,
  onChange,
  holdings,
}: {
  filters: FeedFilters;
  onChange: (filters: FeedFilters) => void;
  holdings: HoldingsResponse | undefined;
}) {
  const t = useTranslations("Dashboard.feed.filter");
  const tStance = useTranslations("Stock.stance");
  const { data: channels } = useSWR<ChannelItem[]>("/api/channels");
  const { data: stocks } = useSWR<StockListItem[]>("/api/stocks");

  const hasHoldings = (holdings?.holdings?.length ?? 0) > 0;

  const channelTitle =
    filters.channelId === "all"
      ? t("allChannels")
      : channels?.find((c) => c.id === filters.channelId)?.title;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasHoldings && (
        <Button
          size="sm"
          variant={filters.holdingsOnly ? "default" : "outline"}
          aria-pressed={filters.holdingsOnly}
          data-testid="feed-filter-holdings"
          onClick={() =>
            onChange({ ...filters, holdingsOnly: !filters.holdingsOnly })
          }
        >
          {t("holdingsOnly")}
        </Button>
      )}
      <Select
        value={filters.channelId}
        onValueChange={(v) => onChange({ ...filters, channelId: v ?? "all" })}
      >
        <SelectTrigger className="w-36 sm:w-40" data-testid="feed-filter-channel">
          <SelectValue placeholder={t("allChannels")}>{channelTitle}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("allChannels")}</SelectItem>
          {(channels ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger
          // base-ui uses render instead of Radix's asChild
          render={
            <Button
              variant="outline"
              size="sm"
              className="w-28 justify-start sm:w-32"
              data-testid="feed-filter-ticker"
            />
          }
        >
          {filters.tickers.length === 0
            ? t("allTickers")
            : t("tickersSelected", { count: filters.tickers.length })}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-72 overflow-y-auto">
          {(stocks ?? []).map((s) => (
            <DropdownMenuCheckboxItem
              key={s.ticker}
              checked={filters.tickers.includes(s.ticker)}
              closeOnClick={false}
              onCheckedChange={() =>
                onChange({ ...filters, tickers: toggleTicker(filters.tickers, s.ticker) })
              }
            >
              {s.ticker}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Select
        value={filters.stance}
        onValueChange={(v) =>
          onChange({ ...filters, stance: (v as StanceValue | "all") ?? "all" })
        }
      >
        <SelectTrigger className="w-28 sm:w-32" data-testid="feed-filter-stance">
          <SelectValue placeholder={t("allStances")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("allStances")}</SelectItem>
          <SelectItem value="buy">{tStance("buy")}</SelectItem>
          <SelectItem value="neutral">{tStance("neutral")}</SelectItem>
          <SelectItem value="sell">{tStance("sell")}</SelectItem>
        </SelectContent>
      </Select>
      {filters.tickers.map((tk) => (
        <button
          key={tk}
          type="button"
          data-testid="active-ticker-chip"
          aria-label={`${t("active")} ${tk}`}
          onClick={() =>
            onChange({ ...filters, tickers: filters.tickers.filter((x) => x !== tk) })
          }
          className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-primary/20"
        >
          <span className="font-mono font-semibold tracking-tight">{tk}</span>
          <X className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}

export function FeedList({
  filters,
  onFiltersChange,
}: {
  filters: FeedFilters;
  onFiltersChange: (filters: FeedFilters) => void;
}) {
  const t = useTranslations("Dashboard");
  const { data: holdings } = useSWR<HoldingsResponse>("/api/portfolio/holdings");
  const heldSet = useMemo(
    () => new Set((holdings?.holdings ?? []).map((h) => h.ticker)),
    [holdings],
  );
  // Highlight set: a selected ticker → highlight only that ticker; holdingsOnly only → highlight holdings; otherwise nothing is dimmed
  const highlightSet: Set<string> | null =
    filters.tickers.length > 0
      ? new Set(filters.tickers)
      : filters.holdingsOnly
        ? heldSet
        : null;
  const getKey = useMemo(
    () => (pageIndex: number, previous: FeedResponse | null) => {
      if (previous && previous.items.length < PAGE_SIZE) return null;
      return feedQuery(pageIndex + 1, filters);
    },
    [filters],
  );
  const { data, error, isLoading, setSize, isValidating } =
    useSWRInfinite<FeedResponse>(getKey);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const pages = data ?? [];
  const items = pages.flatMap((p) => p.items);
  const last = pages[pages.length - 1];
  const reachedEnd = last ? last.items.length < PAGE_SIZE : false;
  const filtersActive =
    filters.channelId !== "all" ||
    filters.tickers.length > 0 ||
    filters.stance !== "all" ||
    filters.holdingsOnly;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isValidating && !reachedEnd) {
        setSize((s) => s + 1);
      }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [setSize, isValidating, reachedEnd]);

  if (isLoading && items.length === 0 && !filtersActive) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-red-500">
        {t("feed.loadError", { message: error.message })}
      </p>
    );
  }
  if (items.length === 0 && !filtersActive && !isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("empty.prompt")}
          <Link href="/channels" className="mx-1 underline">
            {t("empty.linkLabel")}
          </Link>
          {t("empty.hint")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <FeedFilterBar filters={filters} onChange={onFiltersChange} holdings={holdings} />
      {items.length === 0 && !isValidating && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("feed.noMatch")}
        </p>
      )}
      {items.map((item) => (
        <VideoCard key={item.video_id} item={item} highlightSet={highlightSet} />
      ))}
      {!reachedEnd && (
        <div ref={sentinelRef} className="py-4">
          {isValidating && <Skeleton className="h-24 w-full" />}
        </div>
      )}
      {reachedEnd && items.length > 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t("feed.noMore")}
        </p>
      )}
    </div>
  );
}
