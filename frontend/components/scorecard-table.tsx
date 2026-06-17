"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { StanceBadge } from "@/components/stance-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { alphaColor } from "@/components/channel-leaderboard";
import { formatDate, formatPercent } from "@/lib/format";
import type { ScorecardCall } from "@/lib/types";
import { cn } from "@/lib/utils";

function ReturnAlphaCell({
  value,
  alpha,
  hasData,
}: {
  value: number | null;
  alpha: number | null;
  hasData: boolean;
}) {
  const t = useTranslations("Scorecard");
  return (
    <TableCell className="text-right align-top">
      {hasData ? (
        <div className="space-y-0.5">
          <p className={cn("font-mono tabular-nums", alphaColor(value))}>
            {formatPercent(value)}
          </p>
          {alpha != null && (
            <p className={cn("font-mono text-xs tabular-nums", alphaColor(alpha))}>
              {t("vsBenchmark", { value: formatPercent(alpha) })}
            </p>
          )}
        </div>
      ) : (
        <span className="text-muted-foreground">{t("noData")}</span>
      )}
    </TableCell>
  );
}

function ScorecardRow({
  call,
  horizons,
  channelId,
  showDate,
}: {
  call: ScorecardCall;
  horizons: number[];
  channelId: string;
  showDate: boolean;
}) {
  return (
    <TableRow>
      {showDate && (
        <TableCell className="whitespace-nowrap tabular-nums">
          <Link
            href={`/videos/${call.video_id}?ticker=${call.ticker}`}
            title={call.video_title}
            className="hover:underline"
          >
            {formatDate(call.published_at)}
          </Link>
        </TableCell>
      )}
      <TableCell>
        <Link
          href={`/stocks/${call.ticker}?channel=${channelId}`}
          className="font-mono font-semibold hover:underline"
        >
          {call.ticker}
        </Link>
      </TableCell>
      <TableCell title={call.summary}>
        <StanceBadge stance={call.stance} confidence={call.confidence} />
      </TableCell>
      <ReturnAlphaCell
        value={call.now_return}
        alpha={call.now_alpha}
        hasData={call.has_data}
      />
      {horizons.map((h) => (
        <ReturnAlphaCell
          key={h}
          value={call.returns[String(h)]}
          alpha={call.alpha[String(h)]}
          hasData={call.has_data}
        />
      ))}
    </TableRow>
  );
}

export function ScorecardTable({
  calls,
  horizons,
  channelId,
  showDate = true,
}: {
  calls: ScorecardCall[];
  horizons: number[];
  channelId: string;
  showDate?: boolean;
}) {
  const t = useTranslations("Scorecard");
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {showDate && <TableHead>{t("columns.date")}</TableHead>}
            <TableHead>{t("columns.ticker")}</TableHead>
            <TableHead>{t("columns.stance")}</TableHead>
            <TableHead className="text-right">{t("columns.now")}</TableHead>
            {horizons.map((h) => (
              <TableHead key={h} className="text-right">
                {t("columns.horizon", { days: h })}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((call) => (
            <ScorecardRow
              key={`${call.video_id}-${call.ticker}`}
              call={call}
              horizons={horizons}
              channelId={channelId}
              showDate={showDate}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
