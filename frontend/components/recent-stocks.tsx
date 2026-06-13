"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ChannelAvatar } from "@/components/channel-avatar";
import type { TrendingStock, StanceZone } from "@/lib/types";

const PERIODS = [
  { days: 7, key: "week" },
  { days: 30, key: "month" },
  { days: 90, key: "quarter" },
] as const;

const WIDEST_DAYS = 90;

const ZONES = [
  { key: "buy", color: "bg-sky-500" },
  { key: "neutral", color: "bg-zinc-400" },
  { key: "sell", color: "bg-orange-500" },
] as const;

function StanceBar({ stances }: { stances: TrendingStock["stances"] }) {
  const total = stances.buy.count + stances.neutral.count + stances.sell.count;
  if (total === 0) return null;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-muted">
      {ZONES.map(({ key, color }) => {
        const c = stances[key].count;
        if (c === 0) return null;
        return <div key={key} className={color} style={{ width: `${(c / total) * 100}%` }} />;
      })}
    </div>
  );
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

function StockCard({ s }: { s: TrendingStock }) {
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
      <StanceBar stances={s.stances} />
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {ZONES.map(({ key, color }) => (
          <AvatarGroup key={key} zone={s.stances[key]} color={color} />
        ))}
      </div>
    </Link>
  );
}

export function RecentStocks() {
  const t = useTranslations("Dashboard.recentStocks");
  const [days, setDays] = useState<number>(WIDEST_DAYS);
  const { data, isLoading } = useSWR<TrendingStock[]>(
    `/api/stocks/trending?limit=6&days=${days}`,
  );

  // 最寬的視窗(3M)都沒有資料 → 視為尚無討論,整段不顯示
  if (!isLoading && days === WIDEST_DAYS && (!data || data.length === 0)) {
    return null;
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {t("title")}
        </h2>
        <div className="flex gap-1" role="group" aria-label={t("title")}>
          {PERIODS.map((p) => {
            const active = days === p.days;
            return (
              <button
                key={p.days}
                type="button"
                aria-pressed={active}
                onClick={() => setDays(p.days)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent",
                )}
              >
                {t(p.key)}
              </button>
            );
          })}
        </div>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => (
            <StockCard key={s.ticker} s={s} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </section>
  );
}
