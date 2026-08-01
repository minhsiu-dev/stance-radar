"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { tickerColor, withAlpha } from "@/lib/ticker-palette";
import {
  baselineOf,
  markerTime,
  splitRuns,
  toPercentSeries,
} from "@/lib/track-record";
import type { TrackRecordRange, TrackRecordResponse } from "@/lib/types";

const RANGES: TrackRecordRange[] = ["6m", "1y", "all"];
const DEFAULT_ACTIVE = 5;
const CHART_HEIGHT = 360;
const IDLE_ALPHA = 0.18;
const DIMMED_ALPHA = 0.25;
const BENCHMARK_COLOR = "#a1a1aa";

type Entry = {
  series: ISeriesApi<"Line">;
  color: string;
  idle: boolean;
};

/** A stock needs at least two bars to draw a line. Tickers with no price data
 *  (e.g. delisted) still need to show up in the chip row — the list order is
 *  all-time call count, and silently disappearing would look like a sorting bug. */
function hasPrice(item: { closes: unknown[] }): boolean {
  return item.closes.length >= 2;
}

export function ChannelTrackRecordChart({
  channelId,
  onEmptyChange,
}: {
  channelId: string;
  onEmptyChange?: (empty: boolean) => void;
}) {
  const t = useTranslations("ChannelDetail.trackRecordChart");
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [range, setRange] = useState<TrackRecordRange>("1y");
  const [active, setActive] = useState<ReadonlySet<string> | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<Map<string, Entry[]>>(new Map());
  // Mirrors `active` for use inside the chart-creation effect's callbacks
  // (initial series visibility, the crosshair tooltip filter) without making
  // that effect depend on `active` — those reads need the latest value, but
  // toggling a chip must not re-run chart creation (see the visibility effect
  // further down, which is what actually reacts to `active` changing).
  // Assigning a ref during render (rather than in its own effect) means it is
  // always current by the time any later effect or event handler reads it.
  const activeRef = useRef<ReadonlySet<string> | null>(null);
  activeRef.current = active;
  // Same pattern as activeRef above: the parent (ChannelDetail) passes an
  // inline arrow for onEmptyChange, so it gets a fresh identity on every
  // parent render. Reading it through a ref — instead of putting it in the
  // notify-effect's dependency array below — means a new identity alone can
  // never re-run that effect.
  const onEmptyChangeRef = useRef(onEmptyChange);
  onEmptyChangeRef.current = onEmptyChange;

  const { data, error } = useSWR<TrackRecordResponse>(
    `/api/channels/${channelId}/track-record?range=${range}`,
  );

  // Color follows the ticker's all-time rank (the server's return order is the
  // rank), so toggling a chip never recolors the chart.
  const rankOf = useMemo(() => {
    const map = new Map<string, number>();
    (data?.tickers ?? []).forEach((item, i) => map.set(item.ticker, i));
    return map;
  }, [data]);

  // Re-derive `active` every time `data` changes, not just on first load.
  // Drawability is range-dependent: the backend fetches price bars only for
  // the current window while ranking is all-time, so a ticker that had bars
  // in `1y`/`all` can have none in `6m`. Without re-validating here, a chip
  // toggled on under one range/data would stay stuck in `active` — rendered
  // `disabled` (no price) but still `aria-pressed="true"` — with no way for
  // the user to click it off. This only trims membership (it never re-adds a
  // ticker that regains price data); it falls back to the default seed only
  // when the intersection would otherwise be empty, so the chart is never
  // left blank.
  useEffect(() => {
    if (!data) return;
    const drawable = data.tickers.filter(hasPrice).map((item) => item.ticker);
    const drawableSet = new Set(drawable);
    const seedDefault = () => new Set(drawable.slice(0, DEFAULT_ACTIVE));
    setActive((prev) => {
      if (!prev) return seedDefault();
      const kept = new Set([...prev].filter((ticker) => drawableSet.has(ticker)));
      if (kept.size === prev.size) return prev; // nothing dropped — keep the same reference
      return kept.size > 0 ? kept : seedDefault();
    });
  }, [data]);

  const empty = data !== undefined && data.tickers.length === 0;
  // Notify the parent only on an actual transition of `empty` — including the
  // first resolution from "still loading" to a known value — never on every
  // effect run. This is compared against the last value we *reported* (kept
  // in a ref, seeded to `null` = "nothing reported yet"), not against `data`
  // or `empty` by reference/dependency alone: `data` gets a new object
  // identity on every SWR revalidation (e.g. focus refetch) even when its
  // content is unchanged, so relying on that plus a fresh `onEmptyChange`
  // identity each render previously caused a notify -> parent re-render ->
  // new callback -> notify loop that made an auto-expanded table impossible
  // to manually re-collapse while the chart stayed empty.
  const lastReportedEmptyRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (data === undefined) return;
    if (lastReportedEmptyRef.current === empty) return;
    lastReportedEmptyRef.current = empty;
    onEmptyChangeRef.current?.(empty);
  }, [data, empty]);

  // Builds a series for every drawable ticker up front — regardless of
  // whether its chip is currently active — so toggling a chip never has to
  // rebuild the chart; see the visibility effect below, which instead flips
  // `visible` on the series this effect already created. `active` is
  // deliberately NOT a dependency here: only `data` (range/reload), `dark`
  // (theme), and `rankOf` (derived from `data`) legitimately require a full
  // rebuild.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !data || data.tickers.length === 0) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      localization: {
        priceFormatter: (v: number) =>
          `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
      },
    });

    // Add the benchmark first — later-added series draw on top, and the ten
    // stock lines need to sit above the benchmark line.
    const benchmark = chart.addSeries(LineSeries, {
      color: BENCHMARK_COLOR,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: data.benchmark,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    benchmark.setData(
      toPercentSeries(
        data.benchmark_closes,
        baselineOf(data.benchmark_closes),
      ).map((p) => ({ time: p.time as Time, value: p.value })),
    );

    // series -> which ticker it represents and its color, for the crosshair
    // tooltip to look up. `ticker: null` marks the benchmark row, which is
    // always shown regardless of chip state.
    const labels = new Map<
      ISeriesApi<"Line">,
      { name: string; color: string; ticker: string | null }
    >();
    labels.set(benchmark, {
      name: data.benchmark,
      color: BENCHMARK_COLOR,
      ticker: null,
    });

    const entries = new Map<string, Entry[]>();
    for (const item of data.tickers) {
      if (!hasPrice(item)) continue;
      const color = tickerColor(rankOf.get(item.ticker) ?? 0, dark);
      const segments = splitRuns(
        toPercentSeries(item.closes, baselineOf(item.closes)),
        item.runs,
      );
      const created: Entry[] = [];
      segments.forEach((segment, i) => {
        const idle = segment.state === "idle";
        const last = i === segments.length - 1;
        const series = chart.addSeries(LineSeries, {
          color: idle ? withAlpha(color, IDLE_ALPHA) : color,
          lineWidth: idle ? 1 : 2,
          lineStyle:
            segment.state === "sell" ? LineStyle.Dotted : LineStyle.Solid,
          // Direct line-end label: when a single stock is split into multiple
          // segments, only the last segment carries a title — otherwise the
          // price axis would print the same ticker once per segment.
          title: last ? item.ticker : "",
          lastValueVisible: last,
          priceLineVisible: false,
          // Seed initial visibility from the latest `active` (via the ref, not
          // a dependency — see the comment on activeRef above); the visibility
          // effect below takes over from here for subsequent chip toggles.
          visible: activeRef.current?.has(item.ticker) ?? false,
        });
        series.setData(
          segment.points.map((p) => ({ time: p.time as Time, value: p.value })),
        );
        // Anchor the turning-point marker on the segment's own first bar
        // (the bridged/borrowed point doesn't count).
        const marker = item.markers.find((m) => m.date === segment.from);
        const at = markerTime(segment);
        if (marker && at) {
          createSeriesMarkers(series, [
            {
              time: at as Time,
              position: marker.stance === "buy" ? "belowBar" : "aboveBar",
              shape: marker.stance === "buy" ? "arrowUp" : "arrowDown",
              color,
              // No `text` label here: when several tickers open a call within
              // a few days of each other (common right after a channel picks
              // up coverage), lightweight-charts has no cross-series
              // collision avoidance, so per-marker ticker text piles into an
              // illegible smear (found via visual verification). The arrow's
              // shape/color (matching the ticker's line and chip) plus the
              // crosshair tooltip already identify it without needing text
              // that only works when markers happen to be spaced apart.
            },
          ]);
        }
        labels.set(series, { name: item.ticker, color, ticker: item.ticker });
        created.push({ series, color, idle });
      });
      entries.set(item.ticker, created);
    }
    entriesRef.current = entries;
    chart.timeScale().fitContent();

    // Crosshair tooltip: the % value of every *active* series plus the
    // benchmark on the hovered date, sorted by value. Series for toggled-off
    // tickers still exist on the chart (merely `visible: false`) and can
    // still show up in `param.seriesData`, so filter by the current active
    // set (via the ref, kept fresh across renders) rather than assuming
    // invisible series are absent. A stock split into multiple segments
    // usually has data in only one segment per day (boundary days have two),
    // so dedupe by name too.
    chart.subscribeCrosshairMove((param) => {
      const tip = tooltipRef.current;
      if (!tip) return;
      if (!param.point || param.time === undefined) {
        tip.style.display = "none";
        return;
      }
      const seen = new Set<string>();
      const rows: { name: string; color: string; value: number }[] = [];
      for (const [series, meta] of labels) {
        if (meta.ticker !== null && !activeRef.current?.has(meta.ticker)) continue;
        if (seen.has(meta.name)) continue;
        const point = param.seriesData.get(series) as
          | { value?: number }
          | undefined;
        if (point?.value === undefined) continue;
        seen.add(meta.name);
        rows.push({ name: meta.name, color: meta.color, value: point.value });
      }
      if (rows.length === 0) {
        tip.style.display = "none";
        return;
      }
      rows.sort((a, b) => b.value - a.value);

      tip.replaceChildren();
      const head = document.createElement("div");
      head.className = "mb-1 text-muted-foreground";
      head.textContent = String(param.time);
      tip.appendChild(head);
      for (const row of rows) {
        const line = document.createElement("div");
        line.className = "flex items-center gap-1.5";
        const dot = document.createElement("span");
        dot.className = "inline-block h-2 w-2 shrink-0 rounded-sm";
        dot.style.backgroundColor = row.color;
        const name = document.createElement("span");
        name.className = "flex-1";
        name.textContent = row.name; // textContent, not innerHTML
        const value = document.createElement("span");
        value.className = "tabular-nums";
        value.textContent = `${row.value >= 0 ? "+" : ""}${row.value.toFixed(1)}%`;
        line.append(dot, name, value);
        tip.appendChild(line);
      }
      tip.style.display = "block";
      tip.style.left = `${Math.min(
        Math.max(param.point.x + 12, 0),
        Math.max(el.clientWidth - tip.offsetWidth - 8, 0),
      )}px`;
    });

    const resizeObserver = new ResizeObserver((observed) => {
      const width = observed[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      chart.remove(); // series are torn down with the chart, so a range change / reload never accumulates them
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
      entriesRef.current = new Map();
    };
  }, [data, dark, rankOf]);

  // Chip visibility. Must be declared AFTER the chart-creation effect —
  // React flushes effects in declaration order, so entriesRef.current is
  // already populated by the time this runs. Kept as its own effect, keyed
  // only on `active`, so toggling a chip flips `visible` on the existing
  // series (the same technique the hover effect below uses) instead of
  // tearing down and rebuilding the whole chart — which would otherwise
  // discard the user's zoom/pan on every click.
  useEffect(() => {
    for (const [ticker, list] of entriesRef.current) {
      const visible = active?.has(ticker) ?? false;
      for (const entry of list) {
        entry.series.applyOptions({ visible });
      }
    }
  }, [active]);

  // Hover highlighting. Must be declared AFTER the chart-creation effect —
  // React flushes effects in declaration order, so entriesRef.current is
  // already populated by the time this runs. Kept as its own effect so
  // hovering never rebuilds the chart (preserves zoom).
  useEffect(() => {
    for (const [ticker, list] of entriesRef.current) {
      const dim = hovered !== null && hovered !== ticker;
      for (const entry of list) {
        entry.series.applyOptions({
          color: entry.idle
            ? withAlpha(entry.color, dim ? IDLE_ALPHA / 2 : IDLE_ALPHA)
            : dim
              ? withAlpha(entry.color, DIMMED_ALPHA)
              : entry.color,
          lineWidth: entry.idle ? 1 : hovered === ticker ? 3 : 2,
        });
      }
    }
  }, [hovered]);

  function toggle(ticker: string) {
    setActive((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      // Chips with no price data are disabled in the DOM; guard again here
      // for keyboard / programmatic activation.
      if (!next.has(ticker) && !hasPrice(
        data?.tickers.find((item) => item.ticker === ticker) ?? { closes: [] },
      )) {
        return prev;
      }
      if (next.has(ticker)) {
        if (next.size === 1) return prev; // a chart with nothing turned on is meaningless
        next.delete(ticker);
      } else {
        next.add(ticker);
      }
      return next;
    });
  }

  return (
    <Card data-testid="track-record-chart">
      <CardHeader className="space-y-3">
        <div className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Button
                key={r}
                type="button"
                size="sm"
                data-testid={`track-range-${r}`}
                variant={range === r ? "default" : "outline"}
                onClick={() => setRange(r)}
              >
                {t(`range.${r}`)}
              </Button>
            ))}
          </div>
        </div>
        {data && data.tickers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.tickers.map((item, i) => {
              const on = active?.has(item.ticker) ?? false;
              const color = tickerColor(i, dark);
              const drawable = hasPrice(item);
              return (
                <button
                  key={item.ticker}
                  type="button"
                  data-testid={`track-chip-${item.ticker}`}
                  aria-pressed={on}
                  disabled={!drawable}
                  title={
                    drawable
                      ? t("callCount", { count: item.calls })
                      : t("noPriceData", { ticker: item.ticker })
                  }
                  onClick={() => toggle(item.ticker)}
                  onMouseEnter={() => setHovered(item.ticker)}
                  onMouseLeave={() => setHovered(null)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                    !drawable && "cursor-not-allowed opacity-40",
                    on
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{
                      backgroundColor: on ? color : "transparent",
                      boxShadow: on ? undefined : `inset 0 0 0 1px ${color}`,
                    }}
                  />
                  {item.ticker}
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          {t("legend")}
          <span className="mx-2 opacity-60">·</span>
          {t("axisNote")}
        </p>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-red-500">
            {t("error", { message: error.message })}
          </p>
        ) : !data ? (
          <Skeleton className="h-[360px] w-full" />
        ) : empty ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <div className="relative">
            <div ref={containerRef} data-testid="track-record-canvas" />
            <div
              ref={tooltipRef}
              data-testid="track-record-tooltip"
              style={{ display: "none" }}
              className="pointer-events-none absolute top-2 z-10 min-w-[9rem] rounded-md border bg-popover/95 px-2 py-1.5 text-[11px] shadow-sm"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
