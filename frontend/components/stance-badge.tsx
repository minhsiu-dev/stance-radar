import { Badge } from "@/components/ui/badge";
import type { ConfidenceValue, StanceValue } from "@/lib/types";
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

// 信心強度以視覺重量呈現:high 加粗、low 虛線淡化;medium / 未知維持原樣
const CONFIDENCE_STYLES: Record<ConfidenceValue, string> = {
  high: "font-semibold",
  medium: "",
  low: "border-dashed opacity-75",
};

const CONFIDENCE_LABELS: Record<ConfidenceValue, string> = {
  high: "high confidence",
  medium: "medium confidence",
  low: "low confidence",
};

export function StanceBadge({
  stance,
  ticker,
  confidence,
}: {
  stance: StanceValue;
  ticker?: string;
  confidence?: ConfidenceValue | null;
}) {
  return (
    <Badge
      variant="outline"
      title={confidence ? CONFIDENCE_LABELS[confidence] : undefined}
      className={cn(
        "font-mono",
        STANCE_STYLES[stance],
        confidence && CONFIDENCE_STYLES[confidence],
      )}
    >
      {ticker ? `${ticker} · ` : ""}
      {STANCE_LABELS[stance]}
    </Badge>
  );
}
