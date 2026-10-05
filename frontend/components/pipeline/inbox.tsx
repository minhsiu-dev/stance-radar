"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmin } from "@/components/admin-provider";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { PIPELINE_KEY } from "@/lib/pipeline";
import type { DiscoveredResponse } from "@/lib/types";

export const DISCOVERED_KEY = "/api/videos?status=discovered";

type Group = DiscoveredResponse["groups"][number];

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function ChannelGroup({
  group,
  checked,
  onSet,
}: {
  group: Group;
  checked: ReadonlySet<string>;
  onSet: (ids: readonly string[], select: boolean) => void;
}) {
  const t = useTranslations("Pipeline.inbox");
  const ids = group.videos.map((v) => v.id);
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {group.channel.thumbnail_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.channel.thumbnail_url} alt="" className="size-6 rounded-full object-cover" />
          )}
          <span className="truncate">{group.channel.title}</span>
        </span>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="sm" onClick={() => onSet(ids, true)}>
            {t("selectAll")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSet(ids, false)}>
            {t("deselectAll")}
          </Button>
        </div>
      </div>
      <div className="divide-y">
        {group.videos.map((video) => {
          const duration = formatDuration(video.duration_seconds);
          return (
            <label
              key={video.id}
              className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={checked.has(video.id)}
                onChange={() => onSet([video.id], !checked.has(video.id))}
              />
              {video.thumbnail_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={video.thumbnail_url} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />
              )}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-sm">{video.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatDate(video.published_at)}
                  {duration && ` · ${duration}`}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** ① The only manual step: pick which discovered videos enter the pipeline. */
export function Inbox({ total }: { total: number }) {
  const t = useTranslations("Pipeline");
  const { mutate } = useSWRConfig();
  const { handleAuthError } = useAdmin();
  const [open, setOpen] = useState(true);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { data, error, mutate: reload } = useSWR<DiscoveredResponse>(
    total > 0 ? DISCOVERED_KEY : null,
  );

  // The snapshot's count moves when a discover lands; follow it with the list.
  useEffect(() => {
    if (total > 0) void reload();
  }, [total, reload]);

  const allIds = useMemo(
    () => (data?.groups ?? []).flatMap((g) => g.videos.map((v) => v.id)),
    [data],
  );
  const selected = allIds.filter((id) => checked.has(id));

  function setMany(ids: readonly string[], select: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function submit() {
    setSubmitting(true);
    setMessage(null);
    try {
      const skipped = allIds.filter((id) => !checked.has(id));
      if (skipped.length) {
        await apiFetch("/api/videos/skip", {
          method: "POST",
          body: JSON.stringify({ video_ids: skipped }),
        });
      }
      if (selected.length) {
        await apiFetch("/api/videos/analyze", {
          method: "POST",
          body: JSON.stringify({ video_ids: selected }),
        });
      }
      setChecked(new Set());
      await mutate(
        (key) =>
          typeof key === "string" && (key.startsWith("/api/videos") || key === PIPELINE_KEY),
      );
    } catch (err) {
      handleAuthError(err);
      setMessage(t("inbox.submitFailed", { message: err instanceof Error ? err.message : "?" }));
    } finally {
      setSubmitting(false);
    }
  }

  if (total === 0) {
    return (
      <section
        aria-label={t("inbox.title")}
        className="flex items-center justify-between gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm"
      >
        <h2 className="font-semibold">{t("inbox.title")}</h2>
        <span className="text-muted-foreground">{t("inbox.empty")}</span>
      </section>
    );
  }

  return (
    <section aria-label={t("inbox.title")} className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t("inbox.title")}</h2>
          <span className="text-sm text-muted-foreground">{t("inbox.count", { count: total })}</span>
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            {open ? t("inbox.collapse") : t("inbox.expand")}
          </Button>
        </div>
        {open && data && (
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? t("inbox.submitting") : t("inbox.submit", { count: selected.length })}
          </Button>
        )}
      </header>
      {message && <p className="text-sm text-red-500">{message}</p>}
      {open && error && (
        <p className="text-sm text-red-500">{t("loadError", { message: error.message })}</p>
      )}
      {open && !error && !data && <Skeleton className="h-24 w-full" />}
      {open && data && (
        <>
          <p className="text-xs text-muted-foreground">{t("inbox.description")}</p>
          {data.groups.map((group) => (
            <ChannelGroup key={group.channel.id} group={group} checked={checked} onSet={setMany} />
          ))}
        </>
      )}
    </section>
  );
}
