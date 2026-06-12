"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { AppSettings } from "@/lib/types";

/** 後端有開自動更新時顯示「每 N 分鐘自動更新」,沒開不佔空間。 */
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
