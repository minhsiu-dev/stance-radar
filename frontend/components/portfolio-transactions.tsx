"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { PortfolioTransaction, TransactionSide } from "@/lib/types";

const EMPTY_FORM = {
  ticker: "", side: "buy" as TransactionSide, shares: "", price: "",
  executed_on: new Date().toISOString().slice(0, 10), note: "",
};

export function PortfolioTransactions() {
  const t = useTranslations("Portfolio.transactions");
  const { mutate } = useSWRConfig();
  const { data: txs, error } = useSWR<PortfolioTransaction[]>(
    "/api/portfolio/transactions",
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    await mutate(
      (key) => typeof key === "string" && key.startsWith("/api/portfolio"),
    );
    await mutate("/api/news");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const shares = Number(form.shares);
    const price = Number(form.price);
    if (!form.ticker.trim() || !(shares > 0) || !(price > 0)) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch("/api/portfolio/transactions", {
        method: "POST",
        body: JSON.stringify({
          ticker: form.ticker.trim().toUpperCase(),
          side: form.side,
          shares,
          price,
          executed_on: form.executed_on,
          note: form.note.trim() || null,
        }),
      });
      setForm({ ...EMPTY_FORM, executed_on: form.executed_on });
      await refresh();
    } catch (err) {
      setMessage(t("addFailed", {
        message: err instanceof Error ? err.message : "?",
      }));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/api/portfolio/transactions/${id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setMessage(t("deleteFailed", {
        message: err instanceof Error ? err.message : "?",
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={submit}
          className="grid grid-cols-2 items-end gap-2 sm:grid-cols-8"
        >
          <Input
            required
            placeholder={t("tickerPlaceholder")}
            aria-label={t("tickerPlaceholder")}
            value={form.ticker}
            onChange={(e) => setForm({ ...form, ticker: e.target.value })}
            className="uppercase sm:col-span-2"
          />
          <Select
            value={form.side}
            onValueChange={(v) =>
              setForm({ ...form, side: (v as TransactionSide) ?? "buy" })
            }
          >
            <SelectTrigger aria-label={t("title")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="buy">{t("buy")}</SelectItem>
              <SelectItem value="sell">{t("sell")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            required type="number" min="0.000001" step="any"
            aria-label={t("shares")} placeholder={t("shares")}
            value={form.shares}
            onChange={(e) => setForm({ ...form, shares: e.target.value })}
          />
          <Input
            required type="number" min="0.0001" step="any"
            aria-label={t("price")} placeholder={t("price")}
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
          <Input
            required type="date" aria-label={t("dateLabel")}
            value={form.executed_on}
            onChange={(e) => setForm({ ...form, executed_on: e.target.value })}
          />
          <Input
            placeholder={t("note")}
            aria-label={t("note")}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <Button type="submit" disabled={busy}>
            {t("add")}
          </Button>
        </form>
        {message && <p className="text-sm text-red-500">{message}</p>}
        {error && <p className="text-sm text-red-500">{error.message}</p>}
        {!txs && !error && <Skeleton className="h-24 w-full" />}
        {txs && txs.length === 0 && (
          <p className="py-2 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        )}
        {txs && txs.length > 0 && (
          <div className="space-y-1">
            {txs.map((tx) => (
              <div
                key={tx.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 text-sm hover:bg-muted/40"
              >
                <span className="font-medium">{tx.ticker}</span>
                <span
                  className={
                    tx.side === "buy"
                      ? "text-sky-700 dark:text-sky-300"
                      : "text-orange-700 dark:text-orange-300"
                  }
                >
                  {tx.side === "buy" ? t("buy") : t("sell")}
                </span>
                <span className="font-mono tabular-nums">
                  {tx.shares} × ${tx.price}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(tx.executed_on)}
                </span>
                {tx.note && (
                  <span className="text-xs text-muted-foreground">{tx.note}</span>
                )}
                <Button
                  size="sm" variant="ghost" disabled={busy}
                  className="ml-auto"
                  onClick={() => remove(tx.id)}
                >
                  {t("delete")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
