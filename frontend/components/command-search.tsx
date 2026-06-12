"use client";

import { Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { apiFetch } from "@/lib/api";
import type { SearchHit, StockListItem } from "@/lib/types";

const RECENT_KEY = "stance-radar-recent-tickers";
const MAX_RECENT = 5;
const DEBOUNCE_MS = 250;

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function pushRecent(ticker: string): string[] {
  const current = loadRecent().filter((t) => t !== ticker);
  const next = [ticker, ...current].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

export function CommandSearch() {
  const t = useTranslations("Search");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setRecent(loadRecent());
  }, [open]);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [query]);

  const { data: mentioned } = useSWR<StockListItem[]>(
    open ? "/api/stocks" : null,
    apiFetch,
  );

  const { data: remote, error: remoteErr } = useSWR<SearchHit[]>(
    open && debounced
      ? `/api/stocks/search?q=${encodeURIComponent(debounced)}`
      : null,
    apiFetch,
  );

  useEffect(() => setFallback(!!remoteErr), [remoteErr]);

  const navigate = useCallback(
    (ticker: string) => {
      const next = pushRecent(ticker);
      setRecent(next);
      setOpen(false);
      setQuery("");
      router.push(`/${locale}/stocks/${ticker}`);
    },
    [locale, router],
  );

  const mentionedFiltered = (mentioned ?? []).filter(
    (s) =>
      !debounced || s.ticker.toLowerCase().includes(debounced.toLowerCase()),
  );
  const mentionedSet = new Set(mentionedFiltered.map((s) => s.ticker));
  const remoteFiltered = (remote ?? []).filter(
    (h) => !mentionedSet.has(h.ticker),
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t("trigger")}
        className="gap-2"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">{t("trigger")}</span>
        <kbd className="ml-2 hidden rounded bg-muted px-1.5 py-0.5 text-xs sm:inline">
          ⌘K
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command>
        <CommandInput
          placeholder={t("placeholder")}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-[60vh] py-1">
          {fallback && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t("fallback")}
            </div>
          )}
          <CommandEmpty>{t("empty")}</CommandEmpty>
          {!debounced && recent.length > 0 && (
            <CommandGroup heading={t("recent")}>
              {/* 最近瀏覽是短 token,用 pill 橫排比整列好掃、好點 */}
              <div className="flex flex-wrap gap-1.5 px-2 pb-1.5 pt-0.5">
                {recent.map((ticker) => (
                  <CommandItem
                    key={`recent-${ticker}`}
                    value={`recent-${ticker}`}
                    onSelect={() => navigate(ticker)}
                    className="rounded-full! border bg-card px-3 py-1 font-mono text-sm data-selected:border-foreground/40 [&_svg]:hidden"
                  >
                    {ticker}
                  </CommandItem>
                ))}
              </div>
            </CommandGroup>
          )}
          {mentionedFiltered.length > 0 && (
            <CommandGroup heading={t("mentioned")}>
              {mentionedFiltered.map((s) => (
                <CommandItem
                  key={`m-${s.ticker}`}
                  value={`m-${s.ticker}`}
                  onSelect={() => navigate(s.ticker)}
                  className="[&_svg]:hidden"
                >
                  <span className="font-mono">{s.ticker}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {t("mentionCount", { count: s.mention_count })}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {remoteFiltered.length > 0 && (
            <CommandGroup heading={t("all")}>
              {remoteFiltered.map((h) => (
                <CommandItem
                  key={`r-${h.ticker}`}
                  value={`r-${h.ticker}`}
                  onSelect={() => navigate(h.ticker)}
                >
                  <span className="font-mono">{h.ticker}</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {h.name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
        <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 font-sans text-[10px]">↑</kbd>
              <kbd className="rounded border bg-background px-1 font-sans text-[10px]">↓</kbd>
              <span>navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 font-sans text-[10px]">↵</kbd>
              <span>open</span>
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-background px-1 font-sans text-[10px]">esc</kbd>
            <span>close</span>
          </span>
        </div>
        </Command>
      </CommandDialog>
    </>
  );
}
