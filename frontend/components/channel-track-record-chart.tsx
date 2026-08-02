"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  BaselineSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
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
  clipToWindow,
  formatIndexedPercent,
  formatSignedPercent,
  snapMarkers,
  splitRuns,
  toExcessSeries,
  toIndexedSeries,
} from "@/lib/track-record";
import type {
  SparklinePoint,
  TrackRecordMarker,
  TrackRecordRange,
  TrackRecordResponse,
  TrackRecordTicker,
} from "@/lib/types";

const RANGES: TrackRecordRange[] = ["6m", "1y", "all"];
const DEFAULT_ACTIVE = 5;
const CHART_HEIGHT = 360;
const IDLE_ALPHA = 0.18;
const DIMMED_ALPHA = 0.25;
// Same-stance restatements are drawn as faded, smaller arrows so the calls that
// actually changed the stance stay dominant. Mirrors StanceTrendChart's use of
// opacity (not a lighter tint) for repeats — a tint reads brighter in dark mode,
// inverting the meaning.
const REPEAT_MARKER_ALPHA = 0.45;
const REPEAT_MARKER_SIZE = 0.7;
const BENCHMARK_COLOR = "#a1a1aa";

type TrackView = "price" | "performance";
const VIEWS: TrackView[] = ["price", "performance"];
// Losing side of the zero line keeps the ticker's hue, just faded — same
// convention the idle runs use in the price view.
const LOSING_ALPHA = 0.45;

type Entry = {
  series: ISeriesApi<"Line"> | ISeriesApi<"Baseline">;
  color: string;
  /** faded regardless of hover — the price view's "no call yet" segments */
  idle: boolean;
  /** baseline series take topLineColor/bottomLineColor, not color */
  baseline: boolean;
};

/** A stock needs at least two bars to draw a line. Tickers with no price data
 *  (e.g. delisted) still need to show up in the chip row — the list order is
 *  all-time call count, and silently disappearing would look like a sorting bug. */
function hasPrice(item: { closes: unknown[] }): boolean {
  return item.closes.length >= 2;
}

/** Whether a ticker can actually be drawn in the given view.
 *
 *  The price view needs at least two bars WITHIN the window — `item.closes` can
 *  extend earlier than `start` (see clipToWindow's docstring: the backend widens
 *  the fetch to price another ranked ticker's pre-window entry), so a ticker
 *  whose bars are ALL pre-window must not pass here even though `hasPrice`
 *  (unclipped) is true — otherwise its chip renders enabled/default-selected
 *  while the price view draws nothing for it (the "stranded chip" failure).
 *
 *  The performance view additionally needs at least one position producing a
 *  drawable segment — a stock he never called has bars but no line — and,
 *  unlike the price view, must NOT clip `item.closes`/`benchmarkCloses`:
 *  `toExcessSeries` needs the unclipped arrays to price a pre-window entry. */
function drawableIn(
  view: TrackView,
  item: TrackRecordTicker,
  benchmarkCloses: SparklinePoint[],
  start: string,
): boolean {
  if (view === "price") return clipToWindow(item.closes, start).length >= 2;
  if (!hasPrice(item)) return false;
  return item.runs.some(
    (run) => toExcessSeries(item.closes, benchmarkCloses, run).length >= 2,
  );
}

/** Draws every marker in `placed` onto `series` as a directional arrow. Shared
 *  by both the price (LineSeries, one call per run-segment) and performance
 *  (BaselineSeries, one call per position) branches below — the
 *  position/shape/colour/size logic is identical, only the series and the
 *  markers passed in differ. No-ops when there is nothing to place. */
function drawMarkers(
  series: ISeriesApi<"Line"> | ISeriesApi<"Baseline">,
  placed: { marker: TrackRecordMarker; time: string }[],
  color: string,
) {
  if (placed.length === 0) return;
  createSeriesMarkers(
    series,
    placed.map(({ marker, time }) => ({
      time: time as Time,
      position: marker.stance === "buy" ? "belowBar" : "aboveBar",
      shape: marker.stance === "buy" ? "arrowUp" : "arrowDown",
      // Restatements ("repeat") are drawn smaller and faded so the calls that
      // actually changed the stance still read at a glance — same convention
      // as StanceTrendChart's repeat bars.
      color:
        marker.kind === "repeat" ? withAlpha(color, REPEAT_MARKER_ALPHA) : color,
      size: marker.kind === "repeat" ? REPEAT_MARKER_SIZE : 1,
      // No `text` label here: when several tickers call within a few days of
      // each other (common right after a channel picks up coverage),
      // lightweight-charts has no cross-series collision avoidance, so
      // per-marker ticker text piles into an illegible smear (found via
      // visual verification). The arrow's shape/color (matching the ticker's
      // line and chip) plus the crosshair tooltip already identify it
      // without needing text that only works when markers happen to be
      // spaced apart.
    })),
  );
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
  // Linear by default. A channel that made one huge call (e.g. +686%) among
  // several ordinary ones squashes the rest into an unreadable band near
  // zero on a linear axis; log mode is an escape hatch, not the default.
  const [logScale, setLogScale] = useState(false);
  const [view, setView] = useState<TrackView>("price");
  // Named to avoid shadowing the global `window.performance` inside this
  // 785-line component.
  const isPerformanceView = view === "performance";
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
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
  // Same pattern: seeds the initial price-scale mode on chart creation
  // without making that effect depend on `logScale` — the scale-mode effect
  // further down (declared after chart creation, like the visibility/hover
  // effects) is what actually reacts to the toggle changing, via
  // applyOptions rather than a rebuild.
  const logScaleRef = useRef(false);
  logScaleRef.current = logScale;
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

  // Re-derive `active` every time `data` OR `view` changes, not just on first
  // load. Drawability is both range-dependent (the backend fetches price bars
  // only for the current window while ranking is all-time, so a ticker that
  // had bars in `1y`/`all` can have none in `6m`) and view-dependent (the
  // performance view additionally needs a drawable position — a ticker with
  // full price history but every run `idle` draws in the price view but not
  // here). Without re-validating on both, a chip toggled on under one
  // data/view combination would stay stuck in `active` — rendered `disabled`
  // (undrawable) but still `aria-pressed="true"` — with no way for the user
  // to click it off. This only trims membership (it never re-adds a ticker
  // that regains drawability on its own); it falls back to the default seed
  // whenever the surviving intersection is empty, so the chart is never left
  // blank.
  useEffect(() => {
    if (!data) return;
    const drawable = data.tickers
      .filter((item) => drawableIn(view, item, data.benchmark_closes, data.start))
      .map((item) => item.ticker);
    const drawableSet = new Set(drawable);
    const seedDefault = () => new Set(drawable.slice(0, DEFAULT_ACTIVE));
    setActive((prev) => {
      if (!prev) return seedDefault();
      const kept = new Set([...prev].filter((ticker) => drawableSet.has(ticker)));
      // Check the emptied-out case BEFORE the unchanged-membership bail
      // below: when `prev` is itself already an empty Set (everything was
      // undrawable in the previous view/data), `kept` — the intersection of
      // an empty set with anything — is trivially empty too, so
      // `kept.size === prev.size` (0 === 0) would always match and the old
      // ordering could never fall through to `seedDefault()`, permanently
      // stranding the selection empty even after tickers become drawable
      // again. Reseeding here is conditioned on `drawable.length > 0` (not
      // just `kept.size === 0`) so that when NOTHING is drawable at all,
      // this falls through to the reference-equality bail instead of
      // manufacturing a fresh empty Set on every run (which would be a
      // pointless-state-write regression of its own, even though the effect
      // itself can't self-retrigger since it isn't keyed on `active`).
      if (kept.size === 0 && drawable.length > 0) return seedDefault();
      if (kept.size === prev.size) return prev; // nothing dropped — keep the same reference
      return kept;
    });
  }, [data, view]);

  // `empty` also depends on `view`: a channel can have tickers with price
  // history but, in the performance view, none of them holding a drawable
  // position (every run `idle`) — the price view would still draw fine.
  const drawableCount = (data?.tickers ?? []).filter((item) =>
    drawableIn(view, item, data?.benchmark_closes ?? [], data?.start ?? ""),
  ).length;
  const empty = data !== undefined && drawableCount === 0;
  // True only when the channel has made no calls at all (ever) — as opposed
  // to having calls that just aren't drawable in the current view/range. Used
  // to pick the empty-state copy below: "no position in this window" only
  // makes sense when there ARE tickers to have held a position in.
  const noCallsAtAll = data !== undefined && data.tickers.length === 0;
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
    // Captured now, not read via the ref inside the cleanup below: by the
    // time cleanup runs, tooltipRef.current may already point at a
    // different node (or null) than the one this effect's chart was
    // actually built against.
    const tooltipEl = tooltipRef.current;

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
      // The price view plots values indexed to 100 (see track-record.ts for
      // why — it's what keeps log mode's signed-log transform sane) and this
      // formatter subtracts the 100 baseline back out so price-scale ticks
      // and line-end labels (lastValueVisible/title both route through it)
      // read as "+20.0%". The performance view's values are already
      // percentage points centred on zero, so it uses formatSignedPercent
      // directly — the two value spaces must never share a formatter.
      localization: {
        priceFormatter: isPerformanceView
          ? formatSignedPercent
          : formatIndexedPercent,
      },
      // Seed from the latest `logScale` (via the ref, not a dependency —
      // same technique as activeRef above); the scale-mode effect further
      // down takes over from here for subsequent toggle clicks.
      rightPriceScale: {
        // Log is unavailable in the performance view: its values cross zero and
        // lightweight-charts' log scale is a signed-log transform that renders
        // any dip below the baseline as a plunge to the floor.
        mode:
          !isPerformanceView && logScaleRef.current
            ? PriceScaleMode.Logarithmic
            : PriceScaleMode.Normal,
      },
    });
    chartRef.current = chart;

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
    // Hoisted once and reused by BOTH branches below — benchmark_closes may
    // reach back before `data.start` (see clipToWindow's docstring: the
    // backend widens the fetch to price another ranked ticker's pre-window
    // entry). The price view already needed this for its baseline; the
    // performance view's flat zero line needs it too, or it's the only series
    // carrying pre-window bars and chart.timeScale().fitContent() stretches
    // the x-axis back to price_start instead of the selected range (measured
    // on the live app: at range=6m, 103 of benchmark_closes' 228 bars precede
    // the window). Do NOT clip the unclipped `data.benchmark_closes` passed to
    // `toExcessSeries` elsewhere in this effect — that one must stay unclipped
    // so a pre-window position can still be priced from its true entry.
    const benchWindow = clipToWindow(data.benchmark_closes, data.start);
    benchmark.setData(
      isPerformanceView
        ? // A flat zero line: in this view the benchmark IS the baseline, so it
          // stops competing for attention with the ten stock lines.
          benchWindow.map((c) => ({ time: c.date as Time, value: 0 }))
        : // the price view must baseline to the window start, not to
          // benchmark_closes' pre-window extension.
          toIndexedSeries(benchWindow, baselineOf(benchWindow)).map((p) => ({
            time: p.time as Time,
            value: p.value,
          })),
    );

    // series -> which ticker it represents and its color, for the crosshair
    // tooltip to look up. `ticker: null` marks the benchmark row, which is
    // always shown regardless of chip state.
    const labels = new Map<
      ISeriesApi<"Line"> | ISeriesApi<"Baseline">,
      { name: string; color: string; ticker: string | null }
    >();
    labels.set(benchmark, {
      name: data.benchmark,
      color: BENCHMARK_COLOR,
      ticker: null,
    });

    // ticker + date -> the video title that made the call on that date, for
    // the crosshair tooltip to show as provenance under a turning-point row.
    // Keyed by the SNAPPED bar date that snapMarkers resolves each marker to
    // (populated below, alongside each snapMarkers() call), not the marker's
    // own raw date: the tooltip only has the hovered bar's date (`param.time`)
    // to look up with, and a call published on a weekend or holiday snaps
    // forward to the next session — keying by the raw date would leave that
    // entry unreachable from any bar the chart actually plots.
    const markerTitleByKey = new Map<string, string>();

    const entries = new Map<string, Entry[]>();
    for (const item of data.tickers) {
      if (!drawableIn(view, item, data.benchmark_closes, data.start)) continue;
      const color = tickerColor(rankOf.get(item.ticker) ?? 0, dark);
      const created: Entry[] = [];
      if (isPerformanceView) {
        // One position -> one BaselineSeries. Idle runs hold no position and are
        // not drawn at all, so the line only exists while he had a call out.
        const drawable = item.runs
          .map((run) => ({
            run,
            points: toExcessSeries(item.closes, data.benchmark_closes, run),
          }))
          .filter((d) => d.points.length >= 2);
        drawable.forEach(({ run, points }, i) => {
          const last = i === drawable.length - 1;
          const series = chart.addSeries(BaselineSeries, {
            baseValue: { type: "price", price: 0 },
            topLineColor: color,
            bottomLineColor: withAlpha(color, LOSING_ALPHA),
            // Fills off: ten overlapping translucent fills read as mud.
            topFillColor1: "transparent",
            topFillColor2: "transparent",
            bottomFillColor1: "transparent",
            bottomFillColor2: "transparent",
            lineWidth: 2,
            title: last ? item.ticker : "",
            lastValueVisible: last,
            priceLineVisible: false,
            visible: activeRef.current?.has(item.ticker) ?? false,
          });
          series.setData(
            points.map((p) => ({ time: p.time as Time, value: p.value })),
          );
          const placed = snapMarkers(
            { state: run.state, from: run.from, to: run.to, points, bridged: false },
            item.markers,
          );
          for (const { marker, time } of placed) {
            markerTitleByKey.set(`${item.ticker}|${time}`, marker.video_title);
          }
          drawMarkers(series, placed, color);
          labels.set(series, { name: item.ticker, color, ticker: item.ticker });
          created.push({ series, color, idle: false, baseline: true });
        });
      } else {
        // clipToWindow: item.closes may reach back before data.start to price
        // an early-opened position for the performance view (see its
        // docstring) — the price view baselines to the window start, not to
        // that extension, so it must clip first.
        const windowCloses = clipToWindow(item.closes, data.start);
        const segments = splitRuns(
          toIndexedSeries(windowCloses, baselineOf(windowCloses)),
          item.runs,
        );
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
          // Every directional call in this segment gets an arrow, snapped onto a
          // bar the segment actually plots.
          const placed = snapMarkers(segment, item.markers);
          for (const { marker, time } of placed) {
            markerTitleByKey.set(`${item.ticker}|${time}`, marker.video_title);
          }
          drawMarkers(series, placed, color);
          labels.set(series, { name: item.ticker, color, ticker: item.ticker });
          created.push({ series, color, idle, baseline: false });
        });
      }
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
    // so dedupe by name too. When the hovered date is a turning point for a
    // ticker, its row also carries the video title that made the call — the
    // provenance affordance the design spec always intended (an arrow alone
    // shows *that* the channel flipped, not *where they said it*).
    chart.subscribeCrosshairMove((param) => {
      const tip = tooltipRef.current;
      if (!tip) return;
      if (!param.point || param.time === undefined) {
        tip.style.display = "none";
        return;
      }
      const dateKey = String(param.time);
      const seen = new Set<string>();
      const rows: {
        name: string;
        color: string;
        value: number;
        title?: string;
      }[] = [];
      for (const [series, meta] of labels) {
        if (meta.ticker !== null && !activeRef.current?.has(meta.ticker)) continue;
        if (seen.has(meta.name)) continue;
        const point = param.seriesData.get(series) as
          | { value?: number }
          | undefined;
        if (point?.value === undefined) continue;
        seen.add(meta.name);
        const title = meta.ticker
          ? markerTitleByKey.get(`${meta.ticker}|${dateKey}`)
          : undefined;
        rows.push({ name: meta.name, color: meta.color, value: point.value, title });
      }
      if (rows.length === 0) {
        tip.style.display = "none";
        return;
      }
      // Indexed values carry a constant +100 offset over percent change, so
      // sorting by the raw indexed value orders identically to sorting by
      // the displayed percentage — no need to subtract 100 first.
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
        // In the price view row.value is the indexed-to-100 value, not raw
        // percent change (see track-record.ts) — formatIndexedPercent renders
        // it the way the reader expects, matching the price-scale ticks and
        // line-end labels. In the performance view row.value is already a
        // centred percentage point, so it must go through formatSignedPercent
        // instead — same rule as the chart's own priceFormatter above: the
        // two views' value spaces must never share a formatter.
        value.textContent = isPerformanceView
          ? formatSignedPercent(row.value)
          : formatIndexedPercent(row.value);
        line.append(dot, name, value);
        tip.appendChild(line);
        if (row.title) {
          // Supplementary provenance, visually secondary to the row above it
          // (smaller, muted, indented to align under the name) and truncated
          // — the tooltip's width is capped (see the max-w-[220px] on the
          // container below), so a long title must ellipsize, never widen it.
          const sub = document.createElement("div");
          sub.className = "truncate pl-3.5 text-[10px] text-muted-foreground/80";
          sub.textContent = row.title; // textContent, not innerHTML — third-party data
          tip.appendChild(sub);
        }
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
      chartRef.current = null;
      if (tooltipEl) tooltipEl.style.display = "none";
      entriesRef.current = new Map();
    };
    // `isPerformanceView` is deliberately NOT listed here — it is derived
    // purely from `view` (already a dependency), so including it would be a
    // redundant re-run trigger, never a distinct one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dark, rankOf, view]);

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

  // Price-scale mode. Must be declared AFTER the chart-creation effect —
  // React flushes effects in declaration order, so chartRef.current is
  // already populated by the time this runs. Kept as its own effect, keyed
  // only on `logScale`, so toggling linear/log flips the mode on the
  // existing price scale (same technique as chip visibility above) instead
  // of rebuilding the whole chart — which would otherwise discard zoom/pan.
  // PriceScaleMode.Percentage is never used here (see track-record.ts) —
  // only Normal/Logarithmic, which don't rebase series against each other.
  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);

  // Hover highlighting. Must be declared AFTER the chart-creation effect —
  // React flushes effects in declaration order, so entriesRef.current is
  // already populated by the time this runs. Kept as its own effect so
  // hovering never rebuilds the chart (preserves zoom).
  useEffect(() => {
    for (const [ticker, list] of entriesRef.current) {
      const dim = hovered !== null && hovered !== ticker;
      for (const entry of list) {
        const faded = entry.idle
          ? withAlpha(entry.color, dim ? IDLE_ALPHA / 2 : IDLE_ALPHA)
          : dim
            ? withAlpha(entry.color, DIMMED_ALPHA)
            : entry.color;
        // BaselineSeries has no `color` option (only topLineColor/bottomLineColor)
        // — applying `color` to one fails silently, so hover dimming would just
        // quietly stop working in the performance view without this branch.
        if (entry.baseline) {
          entry.series.applyOptions({
            topLineColor: faded,
            bottomLineColor: withAlpha(
              entry.color,
              dim ? DIMMED_ALPHA / 2 : LOSING_ALPHA,
            ),
            lineWidth: hovered === ticker ? 3 : 2,
          });
        } else {
          entry.series.applyOptions({
            color: faded,
            lineWidth: entry.idle ? 1 : hovered === ticker ? 3 : 2,
          });
        }
      }
    }
  }, [hovered]);

  function toggle(ticker: string) {
    setActive((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      // Chips that cannot be drawn in the current view are disabled in the
      // DOM; guard again here for keyboard / programmatic activation.
      const item = data?.tickers.find((entry) => entry.ticker === ticker);
      if (
        !next.has(ticker) &&
        (!item || !drawableIn(view, item, data?.benchmark_closes ?? [], data?.start ?? ""))
      ) {
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {VIEWS.map((v) => (
                <Button
                  key={v}
                  type="button"
                  size="sm"
                  data-testid={`track-view-${v}`}
                  aria-pressed={view === v}
                  variant={view === v ? "default" : "outline"}
                  onClick={() => setView(v)}
                >
                  {t(`view.${v}`)}
                </Button>
              ))}
            </div>
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
            {!isPerformanceView && (
              <div className="flex gap-1 border-l pl-2">
                <Button
                  type="button"
                  size="sm"
                  data-testid="track-scale-linear"
                  aria-pressed={!logScale}
                  variant={!logScale ? "default" : "outline"}
                  onClick={() => setLogScale(false)}
                >
                  {t("scale.linear")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  data-testid="track-scale-log"
                  aria-pressed={logScale}
                  variant={logScale ? "default" : "outline"}
                  onClick={() => setLogScale(true)}
                >
                  {t("scale.log")}
                </Button>
              </div>
            )}
          </div>
        </div>
        {data && data.tickers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.tickers.map((item, i) => {
              const on = active?.has(item.ticker) ?? false;
              const color = tickerColor(i, dark);
              const drawable = drawableIn(view, item, data.benchmark_closes, data.start);
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
                      : hasPrice(item)
                        ? t("noPositionInView", { ticker: item.ticker })
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
          {isPerformanceView ? t("legendPerformance") : t("legend")}
          <span className="mx-2 opacity-60">·</span>
          {isPerformanceView ? t("axisNotePerformance") : t("axisNote")}
        </p>
      </CardHeader>
      <CardContent>
        {/* The chart container stays permanently mounted (hidden via CSS,
         *  never removed from the tree) so a transient revalidation error
         *  (e.g. SWR's revalidateOnFocus) never unmounts it. If it did, the
         *  chart-creation effect below (keyed on [data, dark, rankOf, view],
         *  not on `error`) would not re-run its cleanup — its `data` reference
         *  is unchanged when a revalidation merely fails — leaving the
         *  chart instance attached to a now-detached node while a fresh
         *  empty container mounts underneath, forever. Same pattern as
         *  price-chart.tsx: render the error message above the chart
         *  rather than instead of it. */}
        {error && (
          <p className="mb-2 text-sm text-red-500">
            {t("error", { message: error.message })}
          </p>
        )}
        {!data && !error && <Skeleton className="h-[360px] w-full" />}
        {empty && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {/* A channel with zero calls at all times gets the generic
             *  "empty" copy regardless of view — "no position in this
             *  window" (emptyPerformance) is misleading when the real reason
             *  is "no buy/sell calls yet", the same reason the price view
             *  would give. Only shown for a *genuine* view-specific gap: some
             *  tickers exist and are priced, but none holds a position in
             *  the performance view (e.g. every run is idle). */}
            {isPerformanceView && !noCallsAtAll
              ? t("emptyPerformance")
              : t("empty")}
          </p>
        )}
        <div className={cn("relative", (!data || empty) && "hidden")}>
          <div ref={containerRef} data-testid="track-record-canvas" />
          <div
            ref={tooltipRef}
            data-testid="track-record-tooltip"
            style={{ display: "none" }}
            className="pointer-events-none absolute top-2 z-10 min-w-[9rem] max-w-[220px] rounded-md border bg-popover/95 px-2 py-1.5 text-[11px] shadow-sm"
          />
        </div>
      </CardContent>
    </Card>
  );
}
