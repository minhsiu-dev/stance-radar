"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ChannelAvatar } from "@/components/channel-avatar";
import { StanceMiniBar, ZONES } from "@/components/stance-mini-bar";
import type { TrendingStock, StanceZone } from "@/lib/types";

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

export function StockCard({ s }: { s: TrendingStock }) {
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
        <span className="tabular-nums text-xs font-medium text-muted-foreground">
          {t("channelCount", { count: s.channel_count })}
        </span>
      </div>
      <StanceMiniBar stances={s.stances} />
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {ZONES.map(({ key, color }) => (
          <AvatarGroup key={key} zone={s.stances[key]} color={color} />
        ))}
      </div>
    </Link>
  );
}
