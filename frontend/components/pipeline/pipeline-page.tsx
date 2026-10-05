"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmin } from "@/components/admin-provider";
import { AutoRefreshHint } from "@/components/auto-refresh-hint";
import { RefreshButton } from "@/components/refresh-button";
import { DoneColumn } from "@/components/pipeline/done-column";
import { FailedDrawer } from "@/components/pipeline/failed-drawer";
import { Inbox } from "@/components/pipeline/inbox";
import { LaneColumn } from "@/components/pipeline/lane-column";
import { LANE_NAMES, PIPELINE_KEY, PIPELINE_POLL_MS } from "@/lib/pipeline";
import type { FailureKind, PipelineSnapshot } from "@/lib/types";

/** Ticks once a second so elapsed timers keep moving between the 3s polls. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function LockedNotice({ onUnlock }: { onUnlock: () => void }) {
  const t = useTranslations("Pipeline.locked");
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Lock className="size-6 text-muted-foreground" />
        <p className="font-medium">{t("title")}</p>
        <p className="text-sm text-muted-foreground">{t("body")}</p>
        <Button onClick={onUnlock}>{t("cta")}</Button>
      </CardContent>
    </Card>
  );
}

export function PipelinePage() {
  const t = useTranslations("Pipeline");
  const { ready, authenticated, promptUnlock } = useAdmin();
  const now = useNow();
  const [failedKind, setFailedKind] = useState<FailureKind | null>(null);
  // SWR stops refreshInterval polling while the tab is hidden (refreshWhenHidden: false)
  const { data, error, mutate } = useSWR<PipelineSnapshot>(
    authenticated ? PIPELINE_KEY : null,
    { refreshInterval: PIPELINE_POLL_MS },
  );

  if (!ready) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {authenticated && (
          <div className="flex items-center gap-3">
            <AutoRefreshHint />
            <RefreshButton />
          </div>
        )}
      </div>

      {!authenticated ? (
        <LockedNotice onUnlock={promptUnlock} />
      ) : error && !data ? (
        <p className="text-sm text-red-500">{t("loadError", { message: error.message })}</p>
      ) : !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Inbox total={data.stages.select.total} />
          <div className="grid gap-4 md:grid-cols-3">
            {LANE_NAMES.map((name) => (
              <LaneColumn
                key={name}
                name={name}
                lane={data.lanes[name]}
                stage={data.stages[name]}
                now={now}
                onChanged={() => void mutate()}
                onOpenFailed={() => setFailedKind(name)}
              />
            ))}
            <DoneColumn done={data.stages.done} now={now} />
          </div>
          <FailedDrawer kind={failedKind} onClose={() => setFailedKind(null)} />
        </>
      )}
    </div>
  );
}
