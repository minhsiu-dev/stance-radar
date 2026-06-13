"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StockCard } from "@/components/stock-card";
import type { TrendingStock } from "@/lib/types";

const WINDOWS = [
  { days: 7, key: "week" },
  { days: 30, key: "month" },
  { days: 90, key: "quarter" },
] as const;

export function TrendingStocksPage() {
  const t = useTranslations("Trending");
  const [fresh, setFresh] = useState(30);
  const [count, setCount] = useState(90);
  const { data, isLoading } = useSWR<TrendingStock[]>(
    `/api/stocks/trending?limit=100&days=${fresh}&count_days=${count}`,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="flex flex-wrap gap-4">
          <WindowSelect label={t("freshness")} value={fresh} onChange={setFresh} t={t} />
          <WindowSelect label={t("countWindow")} value={count} onChange={setCount} t={t} />
        </div>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => <StockCard key={s.ticker} s={s} />)}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </div>
  );
}

function WindowSelect({
  label,
  value,
  onChange,
  t,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  t: ReturnType<typeof useTranslations<"Trending">>;
}) {
  const current = WINDOWS.find((w) => w.days === value);
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="w-28">
          <SelectValue>{current ? t(current.key) : ""}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {WINDOWS.map((w) => (
            <SelectItem key={w.days} value={String(w.days)}>
              {t(w.key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
