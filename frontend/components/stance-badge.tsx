import { Badge } from "@/components/ui/badge";
import type { StanceValue } from "@/lib/types";
import { cn } from "@/lib/utils";

const STANCE_STYLES: Record<StanceValue, string> = {
  buy: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  neutral: "border-zinc-500/40 bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  sell: "border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-300",
};

const STANCE_LABELS: Record<StanceValue, string> = {
  buy: "Buy",
  neutral: "Neutral",
  sell: "Sell",
};

export function StanceBadge({
  stance,
  ticker,
}: {
  stance: StanceValue;
  ticker?: string;
}) {
  return (
    <Badge variant="outline" className={cn("font-mono", STANCE_STYLES[stance])}>
      {ticker ? `${ticker} · ` : ""}
      {STANCE_LABELS[stance]}
    </Badge>
  );
}
