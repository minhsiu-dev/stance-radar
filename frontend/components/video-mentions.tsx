"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { StanceBadge } from "@/components/stance-badge";
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
  // 預設全部展開;點標頭可摺疊
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialTicker && highlightRef.current) {
      highlightRef.current.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  }, [initialTicker]);

  if (groups.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("noMentions")}</p>;
  }

  function toggle(ticker: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(ticker) ? next.delete(ticker) : next.add(ticker);
      return next;
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("mentionsHeading")}</h2>
        <span className="text-xs text-muted-foreground">{t("jumpHint")}</span>
      </div>
      {groups.map((g) => {
        const isHighlight = g.ticker === initialTicker;
        const isOpen = !collapsed.has(g.ticker);
        return (
          <div
            key={g.ticker}
            data-testid={`mention-group-${g.ticker}`}
            ref={isHighlight ? highlightRef : undefined}
            className={cn("rounded-lg", isHighlight && "ring-2 ring-primary")}
          >
            <Card className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => toggle(g.ticker)}
                  aria-expanded={isOpen}
                  className="flex items-center gap-2"
                >
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", !isOpen && "-rotate-90")}
                  />
                  <StanceBadge stance={g.stance} ticker={g.ticker} confidence={g.confidence} />
                </button>
                <span className="text-xs text-muted-foreground">
                  {t("mentionCount", { count: g.mentions.length })}
                </span>
                {g.summary && (
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {g.summary}
                  </span>
                )}
                <Link
                  href={`/stocks/${g.ticker}`}
                  className="ml-auto shrink-0 text-xs underline hover:text-foreground"
                >
                  {t("viewStock")}
                </Link>
              </div>
              {isOpen && (
                <ul className="divide-y border-t">
                  {g.mentions.map((m, i) => (
                    <li key={i} className="flex gap-3 p-3 text-sm">
                      <button
                        type="button"
                        onClick={() => onSeek(m.start_seconds)}
                        className="shrink-0 font-mono text-sky-600 hover:underline dark:text-sky-400"
                      >
                        {formatSeconds(m.start_seconds)}
                      </button>
                      <StanceBadge stance={m.stance} confidence={m.confidence} />
                      <span className="min-w-0 flex-1">{m.quote}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        );
      })}
    </section>
  );
}
