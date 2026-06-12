"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { buildMarkers, type ChartMarker } from "@/lib/markers";
import type { CandleDto, StanceRow } from "@/lib/types";

const RANGES = ["3m", "6m", "1y", "3y", "5y"] as const;
type RangeKey = (typeof RANGES)[number];

interface Tooltip {
  x: number;
  y: number;
  lines: string[];
}

export function PriceChart({
  ticker,
  onSelectVideo,
}: {
  ticker: string;
  onSelectVideo?: (videoId: string) => void;
}) {
  const t = useTranslations("Errors");
  const [range, setRange] = useState<RangeKey>("1y");
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  const { data: candles, error, isLoading } = useSWR<CandleDto[]>(
    `/api/stocks/${ticker}/candles?range=${range}`,
    apiFetch,
  );
  const { data: stances } = useSWR<StanceRow[]>(
    `/api/stocks/${ticker}/stances`,
    apiFetch,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !candles || candles.length === 0) return;

    const chart = createChart(el, {
      height: 380,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    series.setData(
      candles.map((c) => ({
        time: c.date,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    const markers = buildMarkers(stances ?? [], candles);
    createSeriesMarkers(series, markers);
    chart.timeScale().fitContent();

    const markersByTime = new Map<string, ChartMarker[]>();
    for (const m of markers) {
      markersByTime.set(m.time, [...(markersByTime.get(m.time) ?? []), m]);
    }
    const stanceById = new Map((stances ?? []).map((s) => [s.video_id, s]));

    chart.subscribeCrosshairMove((param) => {
      const time = param.time as string | undefined;
      const hits = time ? markersByTime.get(time) : undefined;
      if (!hits || !param.point) {
        setTooltip(null);
        return;
      }
      setTooltip({
        x: param.point.x,
        y: param.point.y,
        lines: hits.map((m) => {
          const s = stanceById.get(m.id);
          return s
            ? `${s.channel_title}:${s.video_title}(${s.stance})`
            : m.id;
        }),
      });
    });
    chart.subscribeClick((param) => {
      const time = param.time as string | undefined;
      const hits = time ? markersByTime.get(time) : undefined;
      if (hits?.length && onSelectVideo) onSelectVideo(hits[0].id);
    });

    return () => chart.remove();
  }, [candles, stances, onSelectVideo]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {RANGES.map((r) => (
          <Button
            key={r}
            size="sm"
            variant={r === range ? "default" : "ghost"}
            onClick={() => setRange(r)}
          >
            {r.toUpperCase()}
          </Button>
        ))}
      </div>
      {error && (
        <p className="text-sm text-red-500">
          {t("candlesLoad", { message: error.message })}
        </p>
      )}
      {isLoading && <Skeleton className="h-[380px] w-full" />}
      <div className="relative">
        <div ref={containerRef} className="h-[380px] w-full" />
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded border bg-popover p-2 text-xs shadow"
            style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          >
            {tooltip.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
