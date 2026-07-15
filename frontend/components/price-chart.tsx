"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import {
  buildStanceHistogram,
  buildVideoDays,
  filterStances,
  STANCE_COLORS,
  type StanceHistogramPoint,
  type VideoDay,
} from "@/lib/markers";
import type { CandleDto, StanceRow, StanceValue } from "@/lib/types";

const RANGES = ["1d", "5d", "1m", "3m", "6m", "ytd", "1y", "3y", "5y"] as const;
type RangeKey = (typeof RANGES)[number];

const INTRADAY: ReadonlySet<RangeKey> = new Set(["1d", "5d"]);
const STANCE_PANE_HEIGHT = 64;

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
  const tStance = useTranslations("Stock.stance");
  const [range, setRange] = useState<RangeKey>("3m");
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const stanceSeriesRef = useRef<{
    total: ISeriesApi<"Histogram">;
    buyNeutral: ISeriesApi<"Histogram">;
    buy: ISeriesApi<"Histogram">;
  } | null>(null);
  const videosByTimeRef = useRef<Map<string | number, VideoDay[]>>(new Map());
  const videoDayById = useRef<Map<string, VideoDay>>(new Map());
  const histByTimeRef = useRef<Map<string, StanceHistogramPoint>>(new Map());
  const candleByTime = useRef<Map<string | number, CandleDto>>(new Map());

  const { data: candles, error, isLoading } = useSWR<CandleDto[]>(
    `/api/stocks/${ticker}/candles?range=${range}`,
    apiFetch,
  );
  const { data: stances } = useSWR<StanceRow[]>(
    `/api/stocks/${ticker}/stances`,
    apiFetch,
  );
  const hasAnyStances = (stances?.length ?? 0) > 0;

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

    if (hasAnyStances && !INTRADAY.has(range)) {
      const mkStance = (color: string) =>
        chart.addSeries(
          HistogramSeries,
          {
            color,
            priceFormat: { type: "price", precision: 0, minMove: 1 },
            lastValueVisible: false,
            priceLineVisible: false,
          },
          1,
        );
      // Stacked via cumulative values: series added later draw on top, so the
      // tallest bar (total, sell-colored) goes in first and the shortest (buy)
      // covers the bottom → reads as buy/neutral/sell bottom-up.
      const total = mkStance(STANCE_COLORS.sell);
      const buyNeutral = mkStance(STANCE_COLORS.neutral);
      const buy = mkStance(STANCE_COLORS.buy);
      total.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } });
      chart.panes()[1]?.setHeight(STANCE_PANE_HEIGHT);
      stanceSeriesRef.current = { total, buyNeutral, buy };
    }
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
      const hits = time != null ? videosByTimeRef.current.get(time) : undefined;
      if (hits?.length && onSelectVideo) onSelectVideo(hits[0].id);
    });

    chart.subscribeCrosshairMove((param) => {
      const tip = tooltipRef.current;
      if (!tip) return;
      const time = param.time;
      const p = typeof time === "string" ? histByTimeRef.current.get(time) : undefined;
      if (!p || !param.point) {
        tip.style.display = "none";
        return;
      }
      tip.textContent = `${p.time} · ${tStance("buy")} ${p.buy} · ${tStance("neutral")} ${p.neutral} · ${tStance("sell")} ${p.sell}`;
      tip.style.display = "block";
      const left = Math.min(
        Math.max(param.point.x + 12, 0),
        Math.max(el.clientWidth - tip.offsetWidth - 8, 0),
      );
      tip.style.left = `${left}px`;
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
      stanceSeriesRef.current = null;
    };
  }, [candles, hasAnyStances, onSelectVideo, range, height, tStance]);

  // Recompute the stance histogram + lookup maps when data or filters change —
  // without rebuilding the chart (preserves zoom).
  // NOTE: must stay declared AFTER the chart-creation effect above — React flushes
  // effects in declaration order, so stanceSeriesRef.current is set before this runs.
  useEffect(() => {
    const filtered = filterStances(stances ?? [], stanceFilter, channelFilter);
    const videoDays = buildVideoDays(filtered, candles ?? []);

    const byTime = new Map<string | number, VideoDay[]>();
    const byVideo = new Map<string, VideoDay>();
    for (const v of videoDays) {
      byTime.set(v.time, [...(byTime.get(v.time) ?? []), v]);
      byVideo.set(v.id, v);
    }
    videosByTimeRef.current = byTime;
    videoDayById.current = byVideo;

    const hist = buildStanceHistogram(filtered, candles ?? []);
    histByTimeRef.current = new Map(hist.map((p) => [p.time, p]));
    const s = stanceSeriesRef.current;
    if (s) {
      s.total.setData(
        hist.map((p) => ({ time: p.time as Time, value: p.buy + p.neutral + p.sell })),
      );
      s.buyNeutral.setData(
        hist.map((p) => ({ time: p.time as Time, value: p.buy + p.neutral })),
      );
      s.buy.setData(hist.map((p) => ({ time: p.time as Time, value: p.buy })));
    }
  }, [candles, stances, stanceFilter, channelFilter]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const hit = hoveredVideoId
      ? videoDayById.current.get(hoveredVideoId)
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
      <div className="relative">
        <div
          ref={containerRef}
          style={{ height }}
          className="w-full transition-[height] duration-200"
        />
        <div
          ref={tooltipRef}
          data-testid="stance-tooltip"
          style={{ display: "none", top: 8 }}
          className="pointer-events-none absolute z-10 rounded border bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm"
        />
      </div>
    </div>
  );
}
