"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StanceBadge } from "@/components/stance-badge";
import { formatDate } from "@/lib/format";
import type { ChannelTickerStat } from "@/lib/types";

const SEGMENTS = [
  { key: "buy", color: "bg-sky-500" },
  { key: "neutral", color: "bg-zinc-400" },
  { key: "sell", color: "bg-orange-500" },
] as const;

export function ChannelTopTickers({ rows }: { rows: ChannelTickerStat[] }) {
  const t = useTranslations("ChannelDetail.topTickers");
  const tStance = useTranslations("Stock.stance");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-y-1 space-y-0">
        <CardTitle className="text-base">{t("title")}</CardTitle>
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
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3">{t("ticker")}</th>
                  <th className="py-1.5 pr-3">{t("mentions")}</th>
                  <th className="w-[45%] py-1.5 pr-3">{t("distribution")}</th>
                  <th className="py-1.5">{t("latest")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const total = row.buy + row.neutral + row.sell;
                  return (
                    <tr key={row.ticker} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/stocks/${row.ticker}`}
                          className="font-medium hover:underline"
                        >
                          {row.ticker}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {t("videoCount", { count: row.videos })}
                      </td>
                      <td className="py-2 pr-3">
                        {total > 0 && (
                          <div
                            data-testid={`stance-bar-${row.ticker}`}
                            className="flex h-2.5 overflow-hidden rounded"
                          >
                            {SEGMENTS.map((s) => {
                              const n = row[s.key];
                              if (n === 0) return null;
                              return (
                                <div
                                  key={s.key}
                                  className={s.color}
                                  style={{ width: `${(n / total) * 100}%` }}
                                  title={`${tStance(s.key)}: ${n}`}
                                />
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="py-2">
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
