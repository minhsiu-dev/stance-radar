"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { StanceBadge } from "@/components/stance-badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { VideoDetailGroup } from "@/lib/types";

const STANCE_ACCENT: Record<string, string> = {
  buy: "border-l-sky-500",
  neutral: "border-l-zinc-400",
  sell: "border-l-orange-500",
};

export function MentionsByStock({
  groups,
  initialTicker,
  channelId,
}: {
  groups: VideoDetailGroup[];
  initialTicker: string | null;
  channelId: string;
}) {
  const t = useTranslations("VideoDetail");
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialTicker && highlightRef.current) {
      highlightRef.current.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  }, [initialTicker]);

  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("noMentions")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const isHighlight = g.ticker === initialTicker;
        return (
          <div
            key={g.ticker}
            data-testid={`mention-group-${g.ticker}`}
            ref={isHighlight ? highlightRef : undefined}
            className={cn("rounded-lg", isHighlight && "ring-2 ring-primary")}
          >
            <Card className={cn("border-l-4 p-3", STANCE_ACCENT[g.stance])}>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/stocks/${g.ticker}?channel=${channelId}`}
                  className="font-mono font-semibold hover:underline"
                >
                  {g.ticker}
                </Link>
                <StanceBadge stance={g.stance} confidence={g.confidence} />
              </div>
              {g.summary && (
                <p className="mt-1.5 break-words text-sm text-muted-foreground">
                  {g.summary}
                </p>
              )}
            </Card>
          </div>
        );
      })}
    </div>
  );
}
