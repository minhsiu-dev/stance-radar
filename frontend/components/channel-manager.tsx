"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, apiFetchEnvelope } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { AddChannelsResult, ChannelItem } from "@/lib/types";

export function ChannelManager() {
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
        setMessage(body.error ?? "新增失敗");
        return;
      }
      const parts: string[] = [];
      if (data.added.length) {
        parts.push(`已加入 ${data.added.map((c) => c.title).join("、")}`);
      }
      if (data.skipped.length) parts.push(`已存在:${data.skipped.join("、")}`);
      for (const f of data.failed) parts.push(`${f.id}:${f.reason}`);
      if (data.job_id != null) parts.push("已自動開始抓取影片");
      setMessage(parts.join(";"));
      if (data.added.length) {
        setInput("");
        await mutate();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新增失敗");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(channel: ChannelItem) {
    if (!window.confirm(`移除「${channel.title}」?其影片與分析資料將一併刪除。`)) {
      return;
    }
    try {
      await apiFetch(`/api/channels/${channel.id}`, { method: "DELETE" });
      await mutate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刪除失敗");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">新增頻道</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"貼上一個或多個 channel ID(換行或逗號分隔)\n例:UCbta0n8i6Rljh0obO7HzG9A"}
            rows={3}
          />
          <Button onClick={submit} disabled={submitting || !input.trim()}>
            {submitting ? "新增中…" : "新增"}
          </Button>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {(channels ?? []).map((channel) => (
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
                <p className="truncate font-medium">{channel.title}</p>
                <p className="text-xs text-muted-foreground">
                  {channel.id} · 最後更新:
                  {channel.last_refreshed_at
                    ? formatDate(channel.last_refreshed_at)
                    : "尚未更新"}
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => remove(channel)}>
                移除
              </Button>
            </CardContent>
          </Card>
        ))}
        {channels && channels.length === 0 && (
          <p className="text-sm text-muted-foreground">尚未加入任何頻道。</p>
        )}
      </div>
    </div>
  );
}
