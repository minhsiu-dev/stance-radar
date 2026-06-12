"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, apiFetchEnvelope } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { AddChannelsResult, ChannelItem } from "@/lib/types";

export function ChannelManager() {
  const t = useTranslations("Channels");
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { data: channels, mutate } = useSWR<ChannelItem[]>(
    "/api/channels",
    apiFetch,
  );

  async function submit() {
    if (!input.trim()) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const { body } = await apiFetchEnvelope<AddChannelsResult>("/api/channels", {
        method: "POST",
        body: JSON.stringify({ channel_ids: input }),
      });
      const data = body.data;
      if (!data) {
        setMessage(body.error ?? t("add.failedGeneric"));
        return;
      }
      const parts: string[] = [];
      if (data.added.length) {
        parts.push(t("add.added", { names: data.added.map((c) => c.title).join("、") }));
      }
      if (data.skipped.length) {
        parts.push(t("add.skipped", { names: data.skipped.join("、") }));
      }
      for (const f of data.failed) parts.push(`${f.id}:${f.reason}`);
      if (data.job_id != null) parts.push(t("add.autoFetch"));
      setMessage(parts.join(";"));
      if (data.added.length) {
        setInput("");
        await mutate();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("add.failedGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(channel: ChannelItem) {
    if (!window.confirm(t("list.removePrompt", { name: channel.title }))) {
      return;
    }
    try {
      await apiFetch(`/api/channels/${channel.id}`, { method: "DELETE" });
      await mutate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("list.removeFailed"));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("add.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("add.placeholder")}
            rows={3}
          />
          <Button onClick={submit} disabled={submitting || !input.trim()}>
            {submitting ? t("add.submitting") : t("add.submit")}
          </Button>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {(channels ?? []).map((channel) => {
          const pending = channel.video_counts?.discovered ?? 0;
          return (
            <Card key={channel.id}>
              <CardContent className="flex items-center gap-4 p-4">
                {channel.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={channel.thumbnail_url}
                    alt=""
                    className="h-12 w-12 rounded-full object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/channels/${channel.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {channel.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {channel.id} ·{" "}
                    {channel.last_refreshed_at
                      ? t("list.lastUpdated", {
                          date: formatDate(channel.last_refreshed_at),
                        })
                      : t("list.neverUpdated")}
                  </p>
                </div>
                {channel.auto_analyze && (
                  <Badge
                    variant="outline"
                    className="border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300"
                  >
                    {t("list.autoBadge")}
                  </Badge>
                )}
                {pending > 0 && (
                  <Link href="/review">
                    <Badge variant="secondary">
                      {t("list.pendingBadge", { count: pending })}
                    </Badge>
                  </Link>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => remove(channel)}
                >
                  {t("list.remove")}
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {channels && channels.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
        )}
      </div>
    </div>
  );
}
