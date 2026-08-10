"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useAdmin } from "@/components/admin-provider";
import { failuresSummaryKey } from "@/lib/failures";
import type { FailuresSummary } from "@/lib/types";

/** Admin-only chip next to the refresh button; silent when there is nothing to retry. */
export function FailedVideosLink() {
  const t = useTranslations("Failed");
  const { authenticated } = useAdmin();
  const { data } = useSWR<FailuresSummary>(failuresSummaryKey());
  if (!authenticated) return null;
  if (!data || data.total === 0) return null;
  return (
    <Link
      href="/failed"
      className="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      {t("link", { count: data.total })}
    </Link>
  );
}
