"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiFetchEnvelope } from "@/lib/api";
import type { AddChannelsResult } from "@/lib/types";

export function AddChannelDialog() {
  const t = useTranslations("Channels");
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (submitting || !input.trim()) return;
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
      if (data.added.length) parts.push(t("add.added", { names: data.added.map((c) => c.title).join("、") }));
      if (data.skipped.length) parts.push(t("add.skipped", { names: data.skipped.join("、") }));
      for (const f of data.failed) parts.push(`${f.id}:${f.reason}`);
      if (data.job_id != null) parts.push(t("add.autoFetch"));
      setMessage(parts.join(";"));
      if (data.added.length) {
        setInput("");
        await mutate((key) => typeof key === "string" && key.startsWith("/api/channels"));
        // The channel manager uses useSWRInfinite, whose $inf$ key the predicate above can't
        // target; signal it explicitly so the list refreshes with the newly added channel.
        window.dispatchEvent(new Event("channels:changed"));
        setOpen(false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("add.failedGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setInput("");
          setMessage(null);
        }
        setOpen(v);
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" aria-label={t("add.title")}>
            <Plus className="h-4 w-4" /> {t("add.title")}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("add.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("add.placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={submitting || !input.trim()}>
            {submitting ? t("add.submitting") : t("add.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
