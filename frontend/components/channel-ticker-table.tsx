"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StanceBadge } from "@/components/stance-badge";
import { alphaColor } from "@/components/channel-leaderboard";
import { formatDate } from "@/lib/format";
import type { ChannelTickerRow } from "@/lib/types";

const SEGMENTS = [
  { key: "buy", color: "bg-sky-500" },
  { key: "neutral", color: "bg-zinc-400" },
  { key: "sell", color: "bg-orange-500" },
] as const;

type SortKey = "ticker" | "videos" | "win_rate" | "avg_alpha" | "n";

// nulls always sort last, regardless of direction.
function numCmp(a: number | null, b: number | null, dir: "asc" | "desc"): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

export function ChannelTickerTable({ channelId }: { channelId: string }) {
  const t = useTranslations("ChannelDetail.trackRecord");
  const tDetail = useTranslations("ChannelDetail");
  const tStance = useTranslations("Stock.stance");
  const { data, error } = useSWR<ChannelTickerRow[]>(
    `/api/channels/${channelId}/tickers`,
  );
  const [sortKey, setSortKey] = useState<SortKey>("videos");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const list = [...(data ?? [])];
    list.sort((a, b) => {
      const primary =
        sortKey === "ticker"
          ? (dir === "asc" ? 1 : -1) * a.ticker.localeCompare(b.ticker)
          : numCmp(a[sortKey], b[sortKey], dir);
      return primary !== 0 ? primary : a.ticker.localeCompare(b.ticker);
    });
    return list;
  }, [data, sortKey, dir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir(key === "ticker" ? "asc" : "desc");
    }
  }

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

  const columns: { key: SortKey; label: string; align: "left" | "right" }[] = [
    { key: "ticker", label: t("ticker"), align: "left" },
    { key: "videos", label: t("mentions"), align: "right" },
    { key: "win_rate", label: t("winRate"), align: "right" },
    { key: "avg_alpha", label: t("avgAlpha"), align: "right" },
    { key: "n", label: t("samples"), align: "right" },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-y-1 space-y-0">
        <CardTitle className="text-base">{t("description")}</CardTitle>
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
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={`py-1.5 ${c.align === "right" ? "pl-3 text-right" : "pr-3 text-left"}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {c.label}
                        {sortKey === c.key && (
                          <span aria-hidden>{dir === "asc" ? "▲" : "▼"}</span>
                        )}
                      </button>
                    </th>
                  ))}
                  <th className="hidden w-[28%] py-1.5 pl-3 text-left sm:table-cell">
                    {t("distribution")}
                  </th>
                  <th className="py-1.5 pl-3 text-left">{t("latest")}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const total = row.buy + row.neutral + row.sell;
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
                        {row.win_rate == null ? "—" : `${row.win_rate}%`}
                      </td>
                      <td
                        className={`py-2 pl-3 text-right tabular-nums ${alphaColor(row.avg_alpha)}`}
                      >
                        {row.avg_alpha == null
                          ? "—"
                          : `${row.avg_alpha > 0 ? "+" : ""}${row.avg_alpha}`}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                        {row.n === 0 ? "—" : row.n}
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
        )}
      </CardContent>
    </Card>
  );
}
