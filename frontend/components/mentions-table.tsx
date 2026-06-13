"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { StanceBadge } from "@/components/stance-badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatSeconds } from "@/lib/format";
import type { MentionRow, StanceValue } from "@/lib/types";
import { cn } from "@/lib/utils";

function ChannelAvatar({ title, thumbnail }: { title: string; thumbnail: string }) {
  if (!thumbnail) {
    return (
      <span
        title={title}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase"
      >
        {title.slice(0, 1)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbnail}
      alt={title}
      title={title}
      className="h-7 w-7 rounded-full object-cover"
    />
  );
}

export function MentionsTable({
  ticker,
  selectedVideoId,
  onRowHover,
}: {
  ticker: string;
  selectedVideoId: string | null;
  onRowHover?: (videoId: string | null) => void;
}) {
  const t = useTranslations("Mentions");
  const tStance = useTranslations("Stock.stance");
  const { data, error, isLoading } = useSWR<MentionRow[]>(
    `/api/stocks/${ticker}/mentions`,
  );
  const [stanceFilter, setStanceFilter] = useState<StanceValue | "all">("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const channels = useMemo(
    () =>
      Array.from(
        new Map((data ?? []).map((m) => [m.channel_id, m.channel_title])),
      ),
    [data],
  );

  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (m) =>
          (stanceFilter === "all" || m.stance === stanceFilter) &&
          (channelFilter === "all" || m.channel_id === channelFilter),
      ),
    [data, stanceFilter, channelFilter],
  );

  const selectedChannelTitle =
    channelFilter === "all"
      ? t("filter.allChannels")
      : channels.find(([id]) => id === channelFilter)?.[1];

  useEffect(() => {
    if (!selectedVideoId || !bodyRef.current) return;
    const row = bodyRef.current.querySelector(
      `[data-video-id="${selectedVideoId}"]`,
    );
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedVideoId, rows]);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (error) {
    return (
      <p className="text-sm text-red-500">
        {t("loadError", { message: error.message })}
      </p>
    );
  }
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">{t("title")}</h2>
        <Select
          value={stanceFilter}
          onValueChange={(v) => setStanceFilter(v as StanceValue | "all")}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder={t("filter.stance")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter.allStances")}</SelectItem>
            <SelectItem value="buy">{tStance("buy")}</SelectItem>
            <SelectItem value="neutral">{tStance("neutral")}</SelectItem>
            <SelectItem value="sell">{tStance("sell")}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={channelFilter}
          onValueChange={(v) => setChannelFilter(v ?? "all")}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("filter.channel")}>
              {selectedChannelTitle}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter.allChannels")}</SelectItem>
            {channels.map(([id, title]) => (
              <SelectItem key={id} value={id}>
                {title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.date")}</TableHead>
            <TableHead>{t("columns.channel")}</TableHead>
            <TableHead>{t("columns.timestamp")}</TableHead>
            <TableHead>{t("columns.quote")}</TableHead>
            <TableHead>{t("columns.stance")}</TableHead>
            <TableHead className="w-16 text-right">{t("columns.open")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody ref={bodyRef}>
          {rows.map((m) => (
            <TableRow
              key={m.video_id}
              data-video-id={m.video_id}
              className={cn(selectedVideoId === m.video_id && "bg-accent")}
              onMouseEnter={() => onRowHover?.(m.video_id)}
              onMouseLeave={() => onRowHover?.(null)}
            >
              <TableCell className="whitespace-nowrap">
                {formatDate(m.published_at)}
              </TableCell>
              <TableCell>
                <ChannelAvatar
                  title={m.channel_title}
                  thumbnail={m.channel_thumbnail}
                />
              </TableCell>
              <TableCell className="font-mono">
                <span className="flex flex-wrap gap-x-2 gap-y-1">
                  {m.mentions.map((d) => (
                    <Link
                      key={d.start_seconds}
                      href={`/videos/${m.video_id}?ticker=${ticker}`}
                      className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {formatSeconds(d.start_seconds)}
                    </Link>
                  ))}
                </span>
              </TableCell>
              <TableCell className="max-w-80">
                <HoverCard>
                  <HoverCardTrigger
                    delay={150}
                    render={
                      <span className="line-clamp-2 cursor-help">
                        {m.mentions[0]?.quote}
                        {m.mentions.length > 1 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            +{m.mentions.length - 1}
                          </span>
                        )}
                      </span>
                    }
                  />
                  <HoverCardContent className="max-h-96 w-[min(480px,90vw)] space-y-4 overflow-y-auto text-sm leading-relaxed">
                    {m.mentions.map((d) => (
                      <div key={d.start_seconds}>
                        <p className="mb-1 flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
                          {formatSeconds(d.start_seconds)}
                          <StanceBadge
                            stance={d.stance}
                            confidence={d.confidence}
                          />
                          {d.time_horizon && d.time_horizon !== "unspecified" && (
                            <span className="rounded border px-1 py-0.5 text-[10px] uppercase">
                              {t(`horizon.${d.time_horizon}`)}
                            </span>
                          )}
                        </p>
                        {d.is_conditional && d.condition && (
                          <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                            {t("conditional", { condition: d.condition })}
                          </p>
                        )}
                        {d.context_before && (
                          <p className="mb-2 text-muted-foreground">
                            {d.context_before}
                          </p>
                        )}
                        <p className="font-medium">{d.quote}</p>
                        {d.context_after && (
                          <p className="mt-2 text-muted-foreground">
                            {d.context_after}
                          </p>
                        )}
                      </div>
                    ))}
                  </HoverCardContent>
                </HoverCard>
              </TableCell>
              <TableCell>
                <StanceBadge stance={m.stance} confidence={m.confidence} />
              </TableCell>
              <TableCell className="text-right">
                <Link
                  href={`/videos/${m.video_id}?ticker=${ticker}`}
                  aria-label={t("columns.open")}
                  className="inline-flex items-center justify-end text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
