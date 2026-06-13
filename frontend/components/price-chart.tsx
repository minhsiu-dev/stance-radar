"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { buildMarkers, type ChartMarker } from "@/lib/markers";
import type { CandleDto, StanceRow } from "@/lib/types";

const RANGES = ["1d", "5d", "1m", "3m", "6m", "ytd", "1y", "3y", "5y"] as const;
type RangeKey = (typeof RANGES)[number];

const INTRADAY: ReadonlySet<RangeKey> = new Set(["1d", "5d"]);

interface Tooltip {
  x: number;
  y: number;
  lines: string[];
}

export function PriceChart({
  ticker,
  hoveredVideoId,
  onSelectVideo,
}: {
  ticker: string;
  hoveredVideoId?: string | null;
  onSelectVideo?: (videoId: string) => void;
}) {
  const tErr = useTranslations("Errors");
  const [range, setRange] = useState<RangeKey>("1y");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersByVideoId = useRef<Map<string, ChartMarker>>(new Map());
  const candleByTime = useRef<Map<string | number, CandleDto>>(new Map());
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
        time: (typeof c.time === "number" ? (c.time as UTCTimestamp) : c.time) as UTCTimestamp | string,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    volumeSeries.setData(
      candles.map((c) => ({
        time: (typeof c.time === "number" ? (c.time as UTCTimestamp) : c.time) as UTCTimestamp | string,
        value: c.volume,
        color: c.close >= c.open ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)",
      })),
    );

    const markers = buildMarkers(stances ?? [], candles);
    createSeriesMarkers(series, markers);
    chart.timeScale().fitContent();
    chart.timeScale().applyOptions({
      timeVisible: INTRADAY.has(range),
      secondsVisible: false,
    });

    const markersByTime = new Map<string | number, ChartMarker[]>();
    const byVideo = new Map<string, ChartMarker>();
    for (const m of markers) {
      markersByTime.set(m.time, [...(markersByTime.get(m.time) ?? []), m]);
      byVideo.set(m.id, m);
    }
    markersByVideoId.current = byVideo;
    const byTime = new Map<string | number, CandleDto>();
    for (const c of candles) byTime.set(c.time, c);
    candleByTime.current = byTime;

    const stanceById = new Map((stances ?? []).map((s) => [s.video_id, s]));

    chart.subscribeCrosshairMove((param) => {
      const time = param.time as string | number | undefined;
      const hits = time != null ? markersByTime.get(time) : undefined;
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
      const time = param.time as string | number | undefined;
      const hits = time != null ? markersByTime.get(time) : undefined;
      if (hits?.length && onSelectVideo) onSelectVideo(hits[0].id);
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [candles, stances, onSelectVideo, range]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const hit = hoveredVideoId
      ? markersByVideoId.current.get(hoveredVideoId)
      : undefined;
    const candle = hit ? candleByTime.current.get(hit.time) : undefined;
    // No row hovered, or the hovered video has no marker in the current range
    // (e.g. published before the visible window, or an intraday range with no
    // markers) → clear any prior highlight instead of leaving a stale one.
    if (!hit || !candle) {
      chart.clearCrosshairPosition();
      return;
    }
    chart.setCrosshairPosition(candle.close, hit.time, series);
  }, [hoveredVideoId]);

  const first = candles?.[0]?.close;
  const last = candles?.at(-1)?.close;
  const delta = first && last ? (last - first) / first : null;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <div className="flex gap-1 overflow-x-auto">
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
        {delta != null && (
          <span
            className={cn(
              "text-sm tabular-nums",
              delta >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            {delta >= 0 ? "+" : ""}
            {(delta * 100).toFixed(2)}%
          </span>
        )}
      </div>
      {error && (
        <p className="text-sm text-red-500">
          {tErr("candlesLoad", { message: error.message })}
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
