"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercent } from "@/lib/format";
import type { LeaderboardResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

export function alphaColor(value: number | null): string {
  if (value == null) return "text-muted-foreground";
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

export function ChannelLeaderboard() {
  const t = useTranslations("Dashboard.leaderboard");
  // 排行榜要抓所有頻道的歷史 K 線,較慢:不自動 revalidate
  const { data, isLoading } = useSWR<LeaderboardResponse>(
    "/api/insights/leaderboard",
    { revalidateOnFocus: false, dedupingInterval: 10 * 60 * 1000 },
  );

  if (isLoading) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {t("title")}
        </h2>
        <Skeleton className="h-24 w-full" />
      </section>
    );
  }
  if (!data || data.items.length === 0) return null;

  return (
    <section data-testid="channel-leaderboard">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {t("title")}
        <span className="ml-2 normal-case tracking-normal opacity-70">
          {t("subtitle", { days: data.horizon_days, benchmark: data.benchmark })}
        </span>
      </h2>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("channel")}</TableHead>
              <TableHead className="text-right">{t("avgAlpha")}</TableHead>
              <TableHead className="text-right">{t("buyWinRate")}</TableHead>
              <TableHead className="text-right">{t("sellWinRate")}</TableHead>
              <TableHead className="text-right">{t("calls")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((item) => (
              <TableRow key={item.channel_id}>
                <TableCell>
                  <Link
                    href={`/channels/${item.channel_id}`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    {item.channel_thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.channel_thumbnail}
                        alt=""
                        className="h-6 w-6 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
                        {item.channel_title.slice(0, 1)}
                      </span>
                    )}
                    <span className="max-w-44 truncate font-medium">
                      {item.channel_title}
                    </span>
                  </Link>
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono tabular-nums",
                    alphaColor(item.avg_call_alpha_30d),
                  )}
                >
                  {formatPercent(item.avg_call_alpha_30d)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.buy.win_rate != null ? `${item.buy.win_rate}%` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.sell.win_rate != null ? `${item.sell.win_rate}%` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {item.realized_30d}/{item.calls_total}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
