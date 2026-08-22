"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ChannelAvatar } from "@/components/channel-avatar";
import { StanceMiniBar, ZONES } from "@/components/stance-mini-bar";
import { StanceTrendChart } from "@/components/stance-trend-chart";
import type { TrendingStock, StanceZone, SparklinePoint } from "@/lib/types";

// Whole days since the most recent BUY. Deliberately not last_mentioned_at, which
// also counts sell/neutral — the breakdown line describes the score, and the score
// only counts buys.
function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000));
}

// Three states: no buy call yet, a buy call with no weighted win rate (backend
// omits it when weighted=false or there's no data to weight), and a buy call
// with a win rate to show. Kept as an early-return helper rather than a nested
// ternary so each state stays readable on its own line.
function scoreBreakdownText(
  t: ReturnType<typeof useTranslations<"Dashboard.recentStocks">>,
  s: TrendingStock,
): string {
  if (!s.last_buy_at) return t("scoreBreakdownNoBuys");
  const days = daysSince(s.last_buy_at);
  if (s.channel_win_rate_avg === null) {
    return t("scoreBreakdown", { channels: s.buy_channel_count, days });
  }
  return t("scoreBreakdownWeighted", {
    channels: s.buy_channel_count,
    days,
    winRate: Math.round(s.channel_win_rate_avg),
  });
}

function AvatarGroup({ zone, color }: { zone: StanceZone; color: string }) {
  if (zone.count === 0) return null;
  const extra = zone.count - zone.avatars.length;
  return (
    <div className="flex items-center gap-1">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", color)} aria-hidden />
      <div className="flex -space-x-1.5">
        {zone.avatars.map((a) => (
          <span key={a.title} className="rounded-full ring-2 ring-background">
            <ChannelAvatar title={a.title} thumbnail={a.thumbnail_url} />
          </span>
        ))}
      </div>
      {extra > 0 && <span className="text-xs text-muted-foreground">+{extra}</span>}
    </div>
  );
}

export function StockCard({
  s,
  yMax,
  closes,
  showScore = false,
}: {
  s: TrendingStock;
  yMax?: number;
  closes?: SparklinePoint[];
  // Only /stocks ranks by the score; the homepage / search / strip still rank by
  // channel count, so showing them a score they aren't sorted by would mislead.
  showScore?: boolean;
}) {
  const t = useTranslations("Dashboard.recentStocks");
  return (
    <Link
      href={`/stocks/${s.ticker}`}
      aria-label={s.ticker}
      data-testid="recent-stock-card"
      className="flex flex-col gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono font-semibold tracking-tight">{s.ticker}</span>
        {showScore ? (
          <span
            data-testid="watch-score"
            className="tabular-nums text-xs font-semibold text-foreground"
          >
            {s.watch_score.toFixed(1)}
          </span>
        ) : (
          <span className="tabular-nums text-xs font-medium text-muted-foreground">
            {t("channelCount", { count: s.channel_count })}
          </span>
        )}
      </div>
      {showScore && (
        <p data-testid="score-breakdown" className="text-xs text-muted-foreground">
          {scoreBreakdownText(t, s)}
        </p>
      )}
      <StanceMiniBar stances={s.stances} />
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {ZONES.map(({ key, color }) => (
          <AvatarGroup key={key} zone={s.stances[key]} color={color} />
        ))}
      </div>
      {/* always pass an array so the chart reserves the price row (uniform card heights) */}
      <StanceTrendChart buckets={s.buckets} yMax={yMax} closes={closes ?? []} />
    </Link>
  );
}
