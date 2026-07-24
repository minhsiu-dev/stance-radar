"use client";

import { useEffect, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StanceBadge } from "@/components/stance-badge";
import { alphaColor } from "@/components/channel-leaderboard";
import { formatDate } from "@/lib/format";
import type {
  ChannelTickerResponse,
  ChannelTickerRow,
  PerfFilter,
  TickerPerfSlice,
} from "@/lib/types";

const PAGE_SIZE = 20;

const SEGMENTS = [
  { key: "buy", color: "bg-sky-500" },
  { key: "neutral", color: "bg-zinc-400" },
  { key: "sell", color: "bg-orange-500" },
] as const;

type WindowMode = "matured" | "incl";

function signed(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v}`;
}

export function ChannelTickerTable({ channelId }: { channelId: string }) {
  const t = useTranslations("ChannelDetail.trackRecord");
  const tDetail = useTranslations("ChannelDetail");
  const tPerf = useTranslations("ChannelDetail.performance");
  const tStance = useTranslations("Stock.stance");

  const getKey = (pageIndex: number, previous: ChannelTickerResponse | null) => {
    if (previous && previous.items.length < PAGE_SIZE) return null;
    return `/api/channels/${channelId}/tickers?page=${pageIndex + 1}&page_size=${PAGE_SIZE}`;
  };
  const { data, error, setSize, isValidating } =
    useSWRInfinite<ChannelTickerResponse>(getKey, { revalidateFirstPage: false });

  const [filter, setFilter] = useState<PerfFilter>("all");
  const [windowMode, setWindowMode] = useState<WindowMode>("matured");

  const sliceOf = (r: ChannelTickerRow): TickerPerfSlice =>
    (windowMode === "incl" ? r.perf_incl : r.perf)[filter];

  const pages = data ?? [];
  const items = pages.flatMap((p) => p.items);
  const total = pages[0]?.total ?? 0;
  const hasMore = items.length < total;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isValidating && hasMore) {
          setSize((s) => s + 1);
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [setSize, isValidating, hasMore]);

  if (error) {
    return (
      <p className="text-sm text-red-500">
        {tDetail("loadError", { message: error.message })}
      </p>
    );
  }
  if (!data) {
    return <Skeleton className="h-48 w-full" />;
  }

  const columns: { key: string; label: string }[] = [
    { key: "ticker", label: t("ticker") },
    { key: "videos", label: t("mentions") },
    { key: "win_rate", label: t("winRate") },
    { key: "avg_return", label: t("avgReturn") },
    { key: "avg_alpha", label: t("avgAlpha") },
    { key: "n", label: t("samples") },
  ];
  const filters: { key: PerfFilter; label: string }[] = [
    { key: "all", label: tPerf("filter.all") },
    { key: "buy", label: tStance("buy") },
    { key: "sell", label: tStance("sell") },
  ];

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            {t("title")}
            <HoverCard>
              <HoverCardTrigger
                render={
                  <button
                    type="button"
                    aria-label={t("title")}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                }
              />
              <HoverCardContent className="w-[min(420px,90vw)] text-xs leading-relaxed">
                {t("methodology")}
              </HoverCardContent>
            </HoverCard>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={windowMode === "incl" ? "default" : "outline"}
              onClick={() =>
                setWindowMode((m) => (m === "incl" ? "matured" : "incl"))
              }
            >
              {t("windowIncl")}
            </Button>
            <div className="flex gap-1">
              {filters.map((f) => (
                <Button
                  key={f.key}
                  type="button"
                  size="sm"
                  variant={filter === f.key ? "default" : "outline"}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-sm ${s.color}`} />
              {tStance(s.key)}
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    {columns.map((c, i) => (
                      <th
                        key={c.key}
                        className={`py-1.5 ${i === 0 ? "pr-3 text-left" : "pl-3 text-right"}`}
                      >
                        {c.label}
                      </th>
                    ))}
                    <th className="hidden w-[24%] py-1.5 pl-3 text-left sm:table-cell">
                      {t("distribution")}
                    </th>
                    <th className="py-1.5 pl-3 text-left">{t("latest")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const total = row.buy + row.neutral + row.sell;
                    const p: TickerPerfSlice = sliceOf(row);
                    return (
                      <tr
                        key={row.ticker}
                        data-testid={`ticker-row-${row.ticker}`}
                        data-ticker={row.ticker}
                        className="border-b last:border-0"
                      >
                        <td className="py-2 pr-3">
                          <Link
                            href={`/stocks/${row.ticker}?channel=${channelId}`}
                            className="font-medium hover:underline"
                          >
                            {row.ticker}
                          </Link>
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                          {t("videoCount", { count: row.videos })}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums">
                          {p.win_rate == null ? "—" : `${p.win_rate}%`}
                        </td>
                        <td className={`py-2 pl-3 text-right tabular-nums ${alphaColor(p.avg_return)}`}>
                          {signed(p.avg_return)}
                        </td>
                        <td className={`py-2 pl-3 text-right tabular-nums ${alphaColor(p.avg_alpha)}`}>
                          {signed(p.avg_alpha)}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                          {p.n === 0 && p.pending === 0 ? (
                            "—"
                          ) : (
                            <>
                              {p.n > 0 ? p.n : null}
                              {p.pending > 0 && (
                                <span className="text-[11px] text-muted-foreground/70">
                                  {p.n > 0 ? " " : ""}
                                  {`+${p.pending} ${t("pending")}`}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="hidden py-2 pl-3 sm:table-cell">
                          {total > 0 && (
                            <div
                              data-testid={`stance-bar-${row.ticker}`}
                              className="flex h-2.5 overflow-hidden rounded"
                            >
                              {SEGMENTS.map((s) => {
                                const v = row[s.key];
                                if (v === 0) return null;
                                return (
                                  <div
                                    key={s.key}
                                    className={s.color}
                                    style={{ width: `${(v / total) * 100}%` }}
                                    title={`${tStance(s.key)}: ${v}`}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pl-3">
                          {row.latest_stance && (
                            <span className="inline-flex items-center gap-1.5">
                              <StanceBadge
                                stance={row.latest_stance}
                                ticker={row.ticker}
                                confidence={null}
                              />
                              {row.latest_date && (
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(row.latest_date)}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {hasMore && (
              <div
                ref={sentinelRef}
                data-testid="ticker-table-sentinel"
                aria-hidden
                className="h-1"
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
