"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { AppSettings } from "@/lib/types";

/** Shows "auto-refreshes every N minutes" when the backend has auto-refresh enabled; takes no space when disabled. */
export function AutoRefreshHint() {
  const t = useTranslations("Dashboard.refresh");
  const { data } = useSWR<AppSettings>("/api/settings", {
    revalidateOnFocus: false,
  });
  if (!data || data.auto_refresh_minutes <= 0) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {t("autoEvery", { minutes: data.auto_refresh_minutes })}
    </span>
  );
}
