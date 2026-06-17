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
  if (!data || data.counts.all === 0) return null;
  const now = data.summary.all.now;
  if (now.n === 0) return null;
  if (now.win_rate == null || now.median == null) return null;
  return (
    <p
      className="mt-1 text-xs text-muted-foreground"
      data-testid="channel-perf-line"
    >
      {t("perfLine", {
        winRate: formatWinRate(now.win_rate),
        median: formatSignedPct(now.median),
      })}
    </p>
  );
}
