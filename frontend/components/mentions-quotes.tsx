"use client";

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
import type { VideoDetailGroup } from "@/lib/types";

export function MentionsQuotes({
  groups,
  channelId,
  onSeek,
}: {
  groups: VideoDetailGroup[];
  channelId: string;
  onSeek: (seconds: number) => void;
}) {
  const t = useTranslations("VideoDetail");

  const quotes = groups
    .flatMap((g) => g.mentions.map((m) => ({ ...m, ticker: g.ticker })))
    .sort((a, b) => a.start_seconds - b.start_seconds);

  if (quotes.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("noMentions")}
      </p>
    );
  }

  return (
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
              className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-sky-600 hover:bg-muted/70 dark:text-sky-400"
            >
              {formatSeconds(m.start_seconds)}
            </button>
            <Link
              href={`/stocks/${m.ticker}?channel=${channelId}`}
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
                    <span className="min-w-0 flex-1 cursor-help break-words leading-relaxed">
                      {m.quote}
                    </span>
                  }
                />
                <HoverCardContent className="max-h-96 w-[min(480px,90vw)] overflow-y-auto text-sm leading-relaxed">
                  {m.excerpt}
                </HoverCardContent>
              </HoverCard>
            ) : (
              <span className="min-w-0 flex-1 break-words leading-relaxed">{m.quote}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
