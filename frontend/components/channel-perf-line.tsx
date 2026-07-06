"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { formatSignedPct, formatWinRate } from "@/lib/format";
import type { ChannelPerformanceDto } from "@/lib/types";

export function ChannelPerfLine({ channelId }: { channelId: string }) {
  const t = useTranslations("Channels.list");
  const { data } = useSWR<ChannelPerformanceDto>(
    `/api/channels/${channelId}/performance`,
  );
  if (!data || data.counts.buy === 0) return null;
  const cell = data.summary.buy["90"];
  if (cell.n === 0) return null;
  if (cell.win_rate == null || cell.median == null) return null;
  return (
    <p
      className="mt-1 text-xs text-muted-foreground"
      data-testid="channel-perf-line"
    >
      {t("perfLine", {
        winRate: formatWinRate(cell.win_rate),
        median: formatSignedPct(cell.median),
        n: cell.n,
      })}
    </p>
  );
}
