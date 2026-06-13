"use client";

import useSWR from "swr";
import type { CandleDto } from "@/lib/types";

export function Sparkline({ ticker }: { ticker: string }) {
  const { data } = useSWR<CandleDto[]>(`/api/stocks/${ticker}/candles?range=1d`);
  const closes = (data ?? []).map((c) => c.close);
  if (closes.length < 2) return <div data-testid="sparkline-empty" className="h-8" />;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const W = 100;
  const H = 32;
  const points = closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * W;
      const y = H - ((c - min) / span) * H;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const up = closes[closes.length - 1] >= closes[0];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <polyline
        data-testid="sparkline-line"
        points={points}
        fill="none"
        stroke={up ? "#10b981" : "#ef4444"}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
