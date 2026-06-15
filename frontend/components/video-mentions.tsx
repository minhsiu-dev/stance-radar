"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { StanceBadge } from "@/components/stance-badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Card } from "@/components/ui/card";
import { formatSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VideoDetailGroup } from "@/lib/types";

export function VideoMentions({
  groups,
  onSeek,
  initialTicker,
}: {
  groups: VideoDetailGroup[];
  onSeek: (seconds: number) => void;
  initialTicker: string | null;
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

  // Section B: every mention across all tickers, chronological.
  const quotes = groups
    .flatMap((g) => g.mentions.map((m) => ({ ...m, ticker: g.ticker })))
    .sort((a, b) => a.start_seconds - b.start_seconds);

  return (
    <div className="space-y-6">
      {/* Section A — by stock */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">{t("byStock")}</h3>
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
                <Card className="flex flex-wrap items-center gap-2 p-3">
                  <Link
                    href={`/stocks/${g.ticker}`}
                    className="font-mono font-semibold hover:underline"
                  >
                    {g.ticker}
                  </Link>
                  <StanceBadge stance={g.stance} confidence={g.confidence} />
                  {g.summary && (
                    <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground">
                      {g.summary}
                    </span>
                  )}
                </Card>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section B — quotes in time order */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t("quotesByTime")}
        </h3>
        <Card className="overflow-hidden p-0">
          <ul className="divide-y">
            {quotes.map((m, i) => (
              <li
                key={`${m.ticker}-${m.start_seconds}-${i}`}
                className="flex flex-wrap items-center gap-3 p-3 text-sm"
              >
                <button
                  type="button"
                  onClick={() => onSeek(m.start_seconds)}
                  className="shrink-0 font-mono text-sky-600 hover:underline dark:text-sky-400"
                >
                  {formatSeconds(m.start_seconds)}
                </button>
                <Link
                  href={`/stocks/${m.ticker}`}
                  className="shrink-0 font-mono text-xs font-semibold hover:underline"
                >
                  {m.ticker}
                </Link>
                <StanceBadge stance={m.stance} confidence={m.confidence} />
                {m.excerpt ? (
                  <HoverCard>
                    <HoverCardTrigger
                      delay={150}
                      render={
                        <span className="min-w-0 flex-1 cursor-help break-words">
                          {m.quote}
                        </span>
                      }
                    />
                    <HoverCardContent className="max-h-96 w-[min(480px,90vw)] overflow-y-auto text-sm leading-relaxed">
                      {m.excerpt}
                    </HoverCardContent>
                  </HoverCard>
                ) : (
                  <span className="min-w-0 flex-1 break-words">{m.quote}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
