"use client";

import { useEffect, useMemo, useRef } from "react";
import useSWRInfinite from "swr/infinite";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { StanceBadge } from "@/components/stance-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { alphaColor } from "@/components/channel-leaderboard";
import { formatDate, formatPercent } from "@/lib/format";
import type { Scorecard, ScorecardCall } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

export function ChannelScorecard({ channelId }: { channelId: string }) {
  const t = useTranslations("Scorecard");
  const getKey = useMemo(
    () => (pageIndex: number, previous: Scorecard | null) => {
      if (previous && previous.calls.length < PAGE_SIZE) return null;
      return `/api/channels/${channelId}/scorecard?page=${pageIndex + 1}&page_size=${PAGE_SIZE}`;
    },
    [channelId],
  );
  // 要抓每檔股票的歷史 K 線,較慢:不自動 revalidate
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
  const horizons = pages[0]?.horizons ?? [7, 30, 90];
  const benchmark = pages[0]?.benchmark ?? "";

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
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("description", { benchmark })}
        </p>
      </CardHeader>
      <CardContent>
        {calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.date")}</TableHead>
                    <TableHead>{t("columns.ticker")}</TableHead>
                    <TableHead>{t("columns.stance")}</TableHead>
                    {horizons.map((h) => (
                      <TableHead key={h} className="text-right">
                        {t("columns.horizon", { days: h })}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.map((call) => (
                    <ScorecardRow
                      key={`${call.video_id}-${call.ticker}`}
                      call={call}
                      horizons={horizons}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            {!reachedEnd && (
              <div ref={sentinelRef} aria-hidden className="h-1" />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ScorecardRow({
  call,
  horizons,
}: {
  call: ScorecardCall;
  horizons: number[];
}) {
  const t = useTranslations("Scorecard");
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap tabular-nums">
        <Link
          href={`/videos/${call.video_id}?ticker=${call.ticker}`}
          title={call.video_title}
          className="hover:underline"
        >
          {formatDate(call.published_at)}
        </Link>
      </TableCell>
      <TableCell>
        <Link
          href={`/stocks/${call.ticker}`}
          className="font-mono font-semibold hover:underline"
        >
          {call.ticker}
        </Link>
      </TableCell>
      <TableCell title={call.summary}>
        <StanceBadge stance={call.stance} confidence={call.confidence} />
      </TableCell>
      {horizons.map((h) => {
        const value = call.returns[String(h)];
        const alpha = call.alpha[String(h)];
        return (
          <TableCell key={h} className="text-right align-top">
            {call.has_data ? (
              <div className="space-y-0.5">
                <p
                  className={cn(
                    "font-mono tabular-nums",
                    alphaColor(value),
                  )}
                >
                  {formatPercent(value)}
                </p>
                {alpha != null && (
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    {t("vsBenchmark", { value: formatPercent(alpha) })}
                  </p>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground">{t("noData")}</span>
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}
