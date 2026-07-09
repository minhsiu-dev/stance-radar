"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmin } from "@/components/admin-provider";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { DiscoveredResponse } from "@/lib/types";

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ReviewList() {
  const t = useTranslations("Review");
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { authenticated, handleAuthError } = useAdmin();
  const { data, error, isLoading } = useSWR<DiscoveredResponse>(
    "/api/videos?status=discovered",
  );
  // Default to nothing selected (opt-in): check the ones to analyze; unchecked ones are all skipped on confirm
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const allIds = useMemo(
    () => (data?.groups ?? []).flatMap((g) => g.videos.map((v) => v.id)),
    [data],
  );
  const selected = allIds.filter((id) => checked.has(id));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setMany(ids: string[], select: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function confirm() {
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
      await mutate(
        (key) => typeof key === "string" && key.startsWith("/api/videos"),
      );
      router.push("/");
    } catch (err) {
      handleAuthError(err);
      setMessage(err instanceof Error ? err.message : t("confirmFailed"));
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-red-500">
        {t("loadError", { message: error.message })}
      </p>
    );
  }
  if (!data || data.total === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {data.groups.map((group) => {
        const ids = group.videos.map((v) => v.id);
        return (
          <Card key={group.channel.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                {group.channel.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={group.channel.thumbnail_url}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
                )}
                {group.channel.title}
              </CardTitle>
              {authenticated && (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMany(ids, true)}
                  >
                    {t("selectAll")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMany(ids, false)}
                  >
                    {t("deselectAll")}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-1">
              {group.videos.map((video) => (
                <label
                  key={video.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                >
                  {authenticated ? (
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={checked.has(video.id)}
                      onChange={() => toggle(video.id)}
                    />
                  ) : (
                    <div aria-hidden className="h-4 w-4" />
                  )}
                  {video.thumbnail_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.thumbnail_url}
                      alt=""
                      className="h-12 w-20 shrink-0 rounded object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm font-medium">
                      {video.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(video.published_at)}
                      {formatDuration(video.duration_seconds) &&
                        ` · ${formatDuration(video.duration_seconds)}`}
                    </span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>
        );
      })}
      {authenticated && (
        <div className="sticky bottom-4 flex items-center justify-end gap-3">
          {message && <p className="text-sm text-red-500">{message}</p>}
          <Button onClick={confirm} disabled={submitting}>
            {submitting
              ? t("confirming")
              : t("confirm", { count: selected.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
