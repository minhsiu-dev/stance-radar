"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { StanceBadge } from "@/components/stance-badge";
import { PipelineVideoRow } from "@/components/pipeline/pipeline-video-row";
import { elapsedLabel } from "@/lib/pipeline";
import type { PipelineSnapshot } from "@/lib/types";

/** Rightmost bucket: everything that reached the end in the last 24h and needs
 *  nothing from the operator. Failures stay in their own lane's column. */
export function DoneColumn({
  done,
  now,
}: {
  done: PipelineSnapshot["stages"]["done"];
  now: number;
}) {
  const t = useTranslations("Pipeline.done");
  const hidden = done.total - done.items.length;

  return (
    <section
      aria-label={t("title")}
      className="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/30 p-3"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <span className="text-2xl font-bold tabular-nums">{done.total}</span>
      </header>
      <p className="text-xs text-muted-foreground">{t("window")}</p>

      {done.items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-1">
          {done.items.map((v) => (
            <PipelineVideoRow
              key={v.id}
              video={v}
              muted={v.status === "no_transcript"}
              meta={t("ago", { time: elapsedLabel(v.finished_at, now) })}
            >
              <div className="mt-1 flex flex-wrap gap-1">
                {v.status === "no_transcript" ? (
                  <Badge variant="outline">{t("noTranscript")}</Badge>
                ) : (
                  v.stances.map((s) => (
                    <Link key={s.ticker} href={`/videos/${v.id}`}>
                      <StanceBadge stance={s.stance} ticker={s.ticker} />
                    </Link>
                  ))
                )}
              </div>
            </PipelineVideoRow>
          ))}
          {hidden > 0 && (
            <p className="text-center text-[11px] text-muted-foreground">
              {t("more", { count: hidden })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
