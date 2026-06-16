"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  DndContext, useDraggable, useDroppable, type DragEndEvent,
} from "@dnd-kit/core";
import { Cell, Pie, PieChart } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip,
  ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { masked, usePrivacy } from "@/components/privacy-provider";
import { useHoldingCategories } from "@/lib/use-holding-categories";
import { categoryBreakdown } from "@/lib/portfolio";
import type { HoldingsResponse } from "@/lib/types";

const UNCATEGORIZED = "__uncategorized";
const PIE_COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)",
  "var(--chart-4)", "var(--chart-5)",
];

function money(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function Chip({ ticker }: { ticker: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticker });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`inline-flex cursor-grab rounded-md border bg-card px-2 py-1 text-xs font-medium ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      {ticker}
    </span>
  );
}

function Lane({
  id, name, tickers, onDelete,
}: {
  id: string; name: string; tickers: string[]; onDelete?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-testid={`lane-${id === UNCATEGORIZED ? "uncategorized" : id}`}
      className={`min-h-20 rounded-lg border p-3 ${isOver ? "border-primary bg-accent/40" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{name}</span>
        {onDelete && (
          <button onClick={onDelete} className="text-xs text-muted-foreground hover:text-foreground">
            ✕
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tickers.map((t) => <Chip key={t} ticker={t} />)}
      </div>
    </div>
  );
}

export function PortfolioCategories() {
  const t = useTranslations("Portfolio.categories");
  const { hideAmounts } = usePrivacy();
  const { data } = useSWR<HoldingsResponse>("/api/portfolio/holdings");
  const { categories, assignments, addCategory, deleteCategory, assign } =
    useHoldingCategories();
  const [newName, setNewName] = useState("");

  if (!data) return <Skeleton className="h-64 w-full" />;
  if (data.holdings.length === 0 && data.totals.cash === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>;
  }

  const tickersFor = (catId: string | null) =>
    data.holdings
      .filter((h) => (assignments[h.ticker] ?? null) === catId)
      .map((h) => h.ticker);

  const breakdown = categoryBreakdown(data.holdings, data.totals.cash, assignments);
  const total = data.totals.total_value ?? 0;

  // Build pie slices: each category, then Uncategorized, then Cash (skip zeros).
  const slices = [
    ...categories.map((c, i) => ({
      key: c.id, name: c.name, value: breakdown.byCategory[c.id] ?? 0,
      color: PIE_COLORS[i % PIE_COLORS.length],
    })),
    { key: UNCATEGORIZED, name: t("uncategorized"), value: breakdown.uncategorized, color: "var(--muted-foreground)" },
    { key: "__cash", name: t("cash"), value: breakdown.cash, color: "var(--muted)" },
  ].filter((s) => s.value > 0);

  const config: ChartConfig = Object.fromEntries(
    slices.map((s) => [s.key, { label: s.name, color: s.color }]),
  );

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const ticker = String(e.active.id);
    const target = String(e.over.id);
    assign(ticker, target === UNCATEGORIZED ? null : target);
  }

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("newPlaceholder")}
              />
              <Button
                onClick={() => { if (newName.trim()) { addCategory(newName.trim()); setNewName(""); } }}
              >
                {t("add")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("dragHint")}</p>
            <div className="space-y-2">
              {categories.map((c) => (
                <Lane
                  key={c.id}
                  id={c.id}
                  name={c.name}
                  tickers={tickersFor(c.id)}
                  onDelete={() => deleteCategory(c.id)}
                />
              ))}
              <Lane id={UNCATEGORIZED} name={t("uncategorized")} tickers={tickersFor(null)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            {slices.length > 0 && (
              <ChartContainer config={config} className="mx-auto aspect-square max-h-72">
                <PieChart>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) =>
                          `${name}: ${masked(hideAmounts, money(Number(value)))} (${
                            total ? ((Number(value) / total) * 100).toFixed(1) : "0"
                          }%)`
                        }
                      />
                    }
                  />
                  <Pie data={slices} dataKey="value" nameKey="name" innerRadius={50}>
                    {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
                  </Pie>
                  <ChartLegend content={<ChartLegendContent nameKey="name" />} />
                </PieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </DndContext>
  );
}
