"use client";

import useSWR from "swr";
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
import type { Scorecard, ScorecardHorizonStats } from "@/lib/types";
import { cn } from "@/lib/utils";

function StatCell({ stats }: { stats: ScorecardHorizonStats }) {
  const t = useTranslations("Scorecard");
  if (stats.count === 0) {
    return <p className="text-sm text-muted-foreground">—</p>;
  }
  return (
    <div className="space-y-0.5">
      <p
        className={cn(
          "font-mono text-lg font-semibold tabular-nums",
          alphaColor(stats.avg_return),
        )}
      >
        {formatPercent(stats.avg_return)}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("vsBenchmark", { value: formatPercent(stats.avg_alpha) })}
        <span className="mx-1 opacity-60">·</span>
        {t("winRate", { value: stats.win_rate != null ? `${stats.win_rate}%` : "—" })}
        <span className="mx-1 opacity-60">·</span>
        {t("sampleCount", { count: stats.count })}
      </p>
    </div>
  );
}

export function ChannelScorecard({ channelId }: { channelId: string }) {
  const t = useTranslations("Scorecard");
  // 要抓每檔股票的歷史 K 線,較慢:不自動 revalidate
  const { data, error, isLoading } = useSWR<Scorecard>(
    `/api/channels/${channelId}/scorecard`,
    { revalidateOnFocus: false, dedupingInterval: 10 * 60 * 1000 },
  );

  if (isLoading) {
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
  if (!data) return null;

  return (
    <Card data-testid="channel-scorecard">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("description", { benchmark: data.benchmark })}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {data.calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["buy", "sell"] as const).map((stance) => (
                <div key={stance} className="rounded-md border bg-card/50 p-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <StanceBadge stance={stance} />
                    {t("afterDays", { days: 30 })}
                  </p>
                  <StatCell stats={data.aggregates[stance].horizons["30"]} />
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.date")}</TableHead>
                    <TableHead>{t("columns.ticker")}</TableHead>
                    <TableHead>{t("columns.stance")}</TableHead>
                    {data.horizons.map((h) => (
                      <TableHead key={h} className="text-right">
                        {t("columns.horizon", { days: h })}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.calls.map((call) => (
                    <TableRow key={`${call.video_id}-${call.ticker}`}>
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
                        <StanceBadge
                          stance={call.stance}
                          confidence={call.confidence}
                        />
                      </TableCell>
                      {data.horizons.map((h) => {
                        const value = call.returns[String(h)];
                        const alpha = call.alpha[String(h)];
                        return (
                          <TableCell
                            key={h}
                            className={cn(
                              "text-right font-mono tabular-nums",
                              alphaColor(value),
                            )}
                            title={
                              alpha != null
                                ? t("vsBenchmark", { value: formatPercent(alpha) })
                                : undefined
                            }
                          >
                            {call.has_data ? formatPercent(value) : t("noData")}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
