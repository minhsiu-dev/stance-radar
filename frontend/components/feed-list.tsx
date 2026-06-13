"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { StanceBadge } from "@/components/stance-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ChannelItem,
  FeedItem,
  FeedResponse,
  HoldingsResponse,
  StanceValue,
  StockListItem,
} from "@/lib/types";

function VideoThumb({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div
        aria-hidden
        className="flex h-16 w-28 shrink-0 items-center justify-center rounded bg-gradient-to-br from-muted to-muted/40 text-muted-foreground/60 sm:h-20 sm:w-36"
      >
        <Play className="h-6 w-6" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={title}
      onError={() => setFailed(true)}
      className="h-16 w-28 shrink-0 rounded object-cover sm:h-20 sm:w-36"
    />
  );
}

const PAGE_SIZE = 20;

function StatusTag({ item }: { item: FeedItem }) {
  const t = useTranslations("Dashboard.feed");
  if (item.status === "no_transcript")
    return <Badge variant="secondary">{t("statusNoTranscript")}</Badge>;
  if (item.status === "failed")
    return (
      <Badge variant="destructive" title={item.error_message ?? undefined}>
        {t("statusFailed")}
      </Badge>
    );
  if (item.status === "pending")
    return <Badge variant="secondary">{t("statusPending")}</Badge>;
  if (item.stances.length === 0)
    return <span className="text-xs text-muted-foreground">{t("statusNoMentions")}</span>;
  return null;
}

export interface FeedFilters {
  channelId: string;
  ticker: string;
  stance: StanceValue | "all";
  holdingsOnly: boolean;
}

export const NO_FILTERS: FeedFilters = { channelId: "all", ticker: "all", stance: "all", holdingsOnly: false };

function feedQuery(page: number, filters: FeedFilters): string {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
  });
  if (filters.channelId !== "all") params.set("channel_id", filters.channelId);
  if (filters.ticker !== "all") params.set("ticker", filters.ticker);
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
      <Select
        value={filters.ticker}
        onValueChange={(v) => onChange({ ...filters, ticker: v ?? "all" })}
      >
        <SelectTrigger className="w-28 sm:w-32" data-testid="feed-filter-ticker">
          <SelectValue placeholder={t("allTickers")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("allTickers")}</SelectItem>
          {(stocks ?? []).map((s) => (
            <SelectItem key={s.ticker} value={s.ticker}>
              {s.ticker}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
  // 高亮集合:選了 ticker → 只亮該 ticker;只開 holdingsOnly → 亮持股;否則不變暗
  const highlightSet: Set<string> | null =
    filters.ticker !== "all"
      ? new Set([filters.ticker])
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
    filters.ticker !== "all" ||
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
        <Card
          key={item.video_id}
          className="overflow-hidden transition-colors hover:bg-muted/30"
        >
          <CardContent className="flex gap-3 p-3 sm:gap-4 sm:p-4">
            <VideoThumb url={item.thumbnail_url} title={item.title} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <a
                href={`https://www.youtube.com/watch?v=${item.video_id}`}
                target="_blank"
                rel="noreferrer"
                className="line-clamp-2 text-base font-medium leading-snug hover:underline"
              >
                {item.title}
              </a>
              <p className="text-xs text-muted-foreground">
                <Link
                  href={`/channels/${item.channel.id}`}
                  className="font-medium text-foreground/70 hover:text-foreground hover:underline"
                >
                  {item.channel.title}
                </Link>
                <span className="mx-1.5 opacity-60">·</span>
                {formatDate(item.published_at)}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <StatusTag item={item} />
                {item.stances.map((s) => (
                  <Link
                    key={s.ticker}
                    href={`/stocks/${s.ticker}`}
                    title={s.summary}
                    className={cn(
                      "transition-transform hover:-translate-y-px",
                      highlightSet && !highlightSet.has(s.ticker) && "opacity-40",
                    )}
                  >
                    <StanceBadge
                      stance={s.stance}
                      ticker={s.ticker}
                      confidence={s.confidence}
                    />
                  </Link>
                ))}
                {item.dropped_tickers.length > 0 && (
                  <span
                    className="text-[11px] text-muted-foreground"
                    title={t("feed.droppedHint")}
                  >
                    {t("feed.dropped", {
                      tickers: item.dropped_tickers.join(", "),
                    })}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
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
