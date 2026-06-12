"use client";

import { StockHeader } from "@/components/stock-header";

export function StockView({ ticker }: { ticker: string }) {
  return (
    <div className="space-y-8">
      <StockHeader ticker={ticker} />
    </div>
  );
}
