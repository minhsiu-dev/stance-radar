"use client";

import useSWRInfinite from "swr/infinite";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { useAdmin } from "@/components/admin-provider";
import { formatDate } from "@/lib/format";
import {
  FAILURES_PAGE_SIZE,
  failuresItemsKey,
  type FailuresFilter,
} from "@/lib/failures";
import type { FailedVideosResponse } from "@/lib/types";

/**
 * Read-only, paginated list of failed videos for one filter. Mounted only when its
 * card is expanded, so nothing is fetched until the user asks to see it.
 *
 * A plain "load more" button rather than channel-detail's IntersectionObserver: there
 * the video table is the page's primary content, here it is a detail view behind a
 * toggle, and a button is less machinery for the same job.
 */
export function FailedVideosList({
  filter,
  disabled,
  onRetry,
}: {
  filter: FailuresFilter;
  disabled: boolean;
  onRetry: (videoId: string) => void;
}) {
  const t = useTranslations("Failed");
  const { authenticated } = useAdmin();
  const { data, error, setSize, isValidating } =
    useSWRInfinite<FailedVideosResponse>(
      (pageIndex, previous: FailedVideosResponse | null) => {
        if (previous && previous.items.length < FAILURES_PAGE_SIZE) return null;
        return failuresItemsKey(filter, pageIndex + 1);
      },
      { revalidateFirstPage: false },
    );

  if (!data) {
    if (error) {
      return (
        <p className="text-sm text-red-500">
          {t("loadError", { message: error.message })}
        </p>
      );
    }
    return <Skeleton className="h-24 w-full" />;
  }

  const items = data.flatMap((p) => p.items);
  const total = data[0]?.total ?? 0;
  const hasMore = items.length < total;

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("noneMatchFilter")}</p>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((v) => (
        <div
          key={v.id}
          className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
        >
          {v.thumbnail_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={v.thumbnail_url}
              alt=""
              className="h-12 w-20 shrink-0 rounded object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <Link
              href={`/videos/${v.id}`}
              className="line-clamp-1 text-sm font-medium hover:underline"
            >
              {v.title}
            </Link>
            <p className="text-xs text-muted-foreground">
              {v.channel.title} · {formatDate(v.published_at)} ·{" "}
              {v.last_attempt_at
                ? t("attempts", {
                    count: v.analysis_attempts,
                    date: formatDate(v.last_attempt_at),
                  })
                : t("attemptsNever", { count: v.analysis_attempts })}
            </p>
            {v.error_message && (
              <p
                className="line-clamp-2 text-xs text-muted-foreground/80"
                title={v.error_message}
              >
                {v.error_message}
              </p>
            )}
          </div>
          {authenticated && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => onRetry(v.id)}
            >
              {t("retryOne")}
            </Button>
          )}
        </div>
      ))}
      {error ? (
        <p className="pt-2 text-center text-sm text-red-500">
          {t("loadError", { message: error.message })}
        </p>
      ) : (
        hasMore && (
          <div className="pt-2 text-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={isValidating}
              onClick={() => setSize((s) => s + 1)}
            >
              {t("loadMore")}
            </Button>
          </div>
        )
      )}
    </div>
  );
}
