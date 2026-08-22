"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAdmin } from "@/components/admin-provider";
import { ApiError, apiFetchEnvelope } from "@/lib/api";
import type { AddHoldingsResult, Holding } from "@/lib/types";

export function HoldingsDialog() {
  const t = useTranslations("Holdings");
  const { mutate } = useSWRConfig();
  const { authenticated, handleAuthError } = useAdmin();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { data: holdings } = useSWR<Holding[]>(authenticated ? "/api/holdings" : null);

  // held changed -> every trending page must refetch, or the filter shows stale rows
  async function revalidate() {
    await mutate("/api/holdings");
    await mutate(
      (key) => typeof key === "string" && key.startsWith("/api/stocks/trending"),
    );
  }

  async function add() {
    if (submitting || !input.trim()) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const { status, body } = await apiFetchEnvelope<AddHoldingsResult>("/api/holdings", {
        method: "POST",
        body: JSON.stringify({ tickers: input }),
      });
      if (status === 401) {
        handleAuthError(new ApiError(body.error ?? "", 401));
        return;
      }
      const data = body.data;
      if (!data) {
        setMessage(body.error ?? t("failed"));
        return;
      }
      const parts: string[] = [];
      if (data.added.length) parts.push(t("added", { names: data.added.join("、") }));
      if (data.skipped.length) parts.push(t("skipped", { names: data.skipped.join("、") }));
      setMessage(parts.join("；"));
      setInput("");
      await revalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(ticker: string) {
    try {
      const { status, body } = await apiFetchEnvelope<{ ticker: string }>(
        `/api/holdings/${ticker}`,
        { method: "DELETE" },
      );
      if (status === 401) {
        handleAuthError(new ApiError(body.error ?? "", 401));
        return;
      }
      await revalidate();
    } catch {
      setMessage(t("failed"));
    }
  }

  if (!authenticated) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Base UI's DialogTrigger takes `render=`, NOT Radix's `asChild` */}
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={t("manage")}>
            <Settings2 className="size-4" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={input}
            placeholder={t("placeholder")}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button onClick={add} disabled={submitting}>
            {t("add")}
          </Button>
        </div>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {(holdings ?? []).map((h) => (
            <li key={h.ticker} className="flex items-center justify-between rounded px-2 py-1 hover:bg-accent">
              <span className="font-mono text-sm">{h.ticker}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t("remove")} ${h.ticker}`}
                onClick={() => remove(h.ticker)}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
        {holdings?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
