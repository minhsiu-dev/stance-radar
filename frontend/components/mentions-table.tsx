"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { StanceBadge } from "@/components/stance-badge";
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
import { apiFetch } from "@/lib/api";
import { formatDate, formatSeconds } from "@/lib/format";
import type { MentionRow, StanceValue } from "@/lib/types";
import { cn } from "@/lib/utils";

export function MentionsTable({
  ticker,
  selectedVideoId,
}: {
  ticker: string;
  selectedVideoId: string | null;
}) {
  const t = useTranslations("Mentions");
  const { data, error, isLoading } = useSWR<MentionRow[]>(
    `/api/stocks/${ticker}/mentions`,
    apiFetch,
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
      <div className="flex items-center gap-2">
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
            <SelectItem value="buy">Buy</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
            <SelectItem value="sell">Sell</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={(v) => setChannelFilter(v ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("filter.channel")} />
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
            <TableHead>{t("columns.video")}</TableHead>
            <TableHead>{t("columns.timestamp")}</TableHead>
            <TableHead>{t("columns.quote")}</TableHead>
            <TableHead>{t("columns.stance")}</TableHead>
            <TableHead>{t("columns.reasoning")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody ref={bodyRef}>
          {rows.map((m) => (
            <TableRow
              key={`${m.video_id}-${m.start_seconds}`}
              data-video-id={m.video_id}
              className={cn(
                "cursor-pointer",
                selectedVideoId === m.video_id && "bg-accent",
              )}
              onClick={() => window.open(m.youtube_url, "_blank", "noreferrer")}
              title={t("openHint")}
            >
              <TableCell className="whitespace-nowrap">
                {formatDate(m.published_at)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {m.channel_title}
              </TableCell>
              <TableCell className="max-w-48 truncate">{m.video_title}</TableCell>
              <TableCell className="font-mono">
                {formatSeconds(m.start_seconds)}
              </TableCell>
              <TableCell className="max-w-80">
                <span className="line-clamp-2">{m.quote}</span>
              </TableCell>
              <TableCell>
                <StanceBadge stance={m.stance} />
              </TableCell>
              <TableCell className="max-w-60 text-muted-foreground">
                <span className="line-clamp-2">{m.reasoning}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
