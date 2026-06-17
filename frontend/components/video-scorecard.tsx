"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScorecardTable } from "@/components/scorecard-table";
import type { Scorecard } from "@/lib/types";

export function VideoScorecard({
  videoId,
  channelId,
}: {
  videoId: string;
  channelId: string;
}) {
  const t = useTranslations("Scorecard");
  const tv = useTranslations("VideoDetail");
  const { data, error, isLoading } = useSWR<Scorecard>(
    `/api/videos/${videoId}/scorecard`,
  );

  const calls = data?.calls ?? [];
  const horizons = data?.horizons ?? [30, 90];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tv("callPerformance")}</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-red-500">
            {t("loadError", { message: (error as Error).message })}
          </p>
        )}
        {isLoading && !data && <Skeleton className="h-24 w-full" />}
        {data && calls.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}
        {calls.length > 0 && (
          <ScorecardTable
            calls={calls}
            horizons={horizons}
            channelId={channelId}
            showDate={false}
          />
        )}
      </CardContent>
    </Card>
  );
}
