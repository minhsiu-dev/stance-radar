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
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { buildMarkers, filterStances, type ChartMarker } from "@/lib/markers";
import type { CandleDto, StanceRow, StanceValue } from "@/lib/types";

const RANGES = ["1d", "5d", "1m", "3m", "6m", "ytd", "1y", "3y", "5y"] as const;
type RangeKey = (typeof RANGES)[number];

const INTRADAY: ReadonlySet<RangeKey> = new Set(["1d", "5d"]);

export function PriceChart({
  ticker,
  hoveredVideoId,
  onSelectVideo,
  height = 380,
  stanceFilter = "all",
  channelFilter = "all",
}: {
  ticker: string;
  hoveredVideoId?: string | null;
  onSelectVideo?: (videoId: string) => void;
  height?: number;
  stanceFilter?: StanceValue | "all";
  channelFilter?: string;
}) {
  const tErr = useTranslations("Errors");
  const [range, setRange] = useState<RangeKey>("6m");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const markersByTimeRef = useRef<Map<string | number, ChartMarker[]>>(new Map());
  const markersByVideoId = useRef<Map<string, ChartMarker>>(new Map());
  const candleByTime = useRef<Map<string | number, CandleDto>>(new Map());

  const { data: candles, error, isLoading } = useSWR<CandleDto[]>(
    `/api/stocks/${ticker}/candles?range=${range}`,
    apiFetch,
  );
  const { data: stances } = useSWR<StanceRow[]>(
    `/api/stocks/${ticker}/stances`,
    apiFetch,
  );

  // Create the chart once per (candles, range). Markers are managed by a
  // separate effect so changing a filter never rebuilds the chart (preserves zoom).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !candles || candles.length === 0) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
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

    markersApiRef.current = createSeriesMarkers(series, []);
    chart.timeScale().fitContent();
    chart.timeScale().applyOptions({
      timeVisible: INTRADAY.has(range),
      secondsVisible: false,
    });

    const byTime = new Map<string | number, CandleDto>();
    for (const c of candles) byTime.set(c.time, c);
    candleByTime.current = byTime;

    chart.subscribeClick((param) => {
      const time = param.time as string | number | undefined;
      const hits = time != null ? markersByTimeRef.current.get(time) : undefined;
      if (hits?.length && onSelectVideo) onSelectVideo(hits[0].id);
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Reframe the chart to its container whenever the column width changes
    // (window resize, lg breakpoint crossover, sidebar toggle).
    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersApiRef.current = null;
    };
  }, [candles, onSelectVideo, range, height]);

  // Recompute markers when the data or the filters change — without rebuilding
  // the chart. Also refresh the click/hover lookup maps.
  useEffect(() => {
    const markers = buildMarkers(
      filterStances(stances ?? [], stanceFilter, channelFilter),
      candles ?? [],
    );
    markersApiRef.current?.setMarkers(markers);

    const byTime = new Map<string | number, ChartMarker[]>();
    const byVideo = new Map<string, ChartMarker>();
    for (const m of markers) {
      byTime.set(m.time, [...(byTime.get(m.time) ?? []), m]);
      byVideo.set(m.id, m);
    }
    markersByTimeRef.current = byTime;
    markersByVideoId.current = byVideo;
  }, [candles, stances, stanceFilter, channelFilter]);

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
      {isLoading && <Skeleton style={{ height }} className="w-full" />}
      <div ref={containerRef} style={{ height }} className="w-full transition-[height] duration-200" />
    </div>
  );
}
