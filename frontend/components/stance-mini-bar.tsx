import { cn } from "@/lib/utils";
import type { TrendingStock } from "@/lib/types";

export const ZONES = [
  { key: "buy", color: "bg-sky-500" },
  { key: "neutral", color: "bg-zinc-400" },
  { key: "sell", color: "bg-orange-500" },
] as const;

export function StanceMiniBar({
  stances,
  className,
}: {
  stances: TrendingStock["stances"];
  className?: string;
}) {
  const total = stances.buy.count + stances.neutral.count + stances.sell.count;
  if (total === 0) return null;
  return (
    <div className={cn("flex h-2 overflow-hidden rounded-full bg-muted", className)}>
      {ZONES.map(({ key, color }) => {
        const c = stances[key].count;
        if (c === 0) return null;
        return <div key={key} className={color} style={{ width: `${(c / total) * 100}%` }} />;
      })}
    </div>
  );
}
