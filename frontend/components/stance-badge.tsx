import { Badge } from "@/components/ui/badge";
import type { StanceValue } from "@/lib/types";
import { cn } from "@/lib/utils";

const STANCE_STYLES: Record<StanceValue, string> = {
  buy: "border-green-600/40 bg-green-600/15 text-green-500",
  neutral: "border-zinc-500/40 bg-zinc-500/15 text-zinc-400",
  sell: "border-red-600/40 bg-red-600/15 text-red-500",
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
