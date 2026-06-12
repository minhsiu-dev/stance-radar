"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { DiscoveredResponse } from "@/lib/types";

export function PendingReviewBanner() {
  const t = useTranslations("Review");
  const { data } = useSWR<DiscoveredResponse>("/api/videos?status=discovered");
  if (!data || data.total === 0) return null;
  return (
    <Link
      href="/review"
      className="flex items-center justify-between rounded-lg border border-amber-400/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
    >
      <span>{t("banner", { count: data.total })}</span>
      <span className="font-medium underline">{t("bannerCta")}</span>
    </Link>
  );
}
