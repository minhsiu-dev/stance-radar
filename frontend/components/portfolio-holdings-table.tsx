"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { masked, usePrivacy } from "@/components/privacy-provider";
import type { HoldingsResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

function num(v: number | null, digits = 2): string {
  return v == null ? "—" : v.toLocaleString("en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

function shares(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function plClass(v: number | null): string {
  if (v == null) return "";
  return v >= 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
}

export function PortfolioHoldingsTable() {
  const t = useTranslations("Portfolio.holdings");
  const { hideAmounts } = usePrivacy();
  const { data } = useSWR<HoldingsResponse>("/api/portfolio/holdings");

  if (!data) return <Skeleton className="h-48 w-full" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.holdings.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{t("ticker")}</th>
                  <th className="py-2 pr-3 text-right">{t("shares")}</th>
                  <th className="py-2 pr-3 text-right">{t("avgCost")}</th>
                  <th className="py-2 pr-3 text-right">{t("price")}</th>
                  <th className="py-2 pr-3 text-right">{t("marketValue")}</th>
                  <th className="py-2 pr-3 text-right">{t("pl")}</th>
                  <th className="py-2 text-right">{t("weight")}</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => (
                  <tr key={h.ticker} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <Link
                        href={`/stocks/${h.ticker}`}
                        className="font-medium hover:underline"
                      >
                        {h.ticker}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {masked(hideAmounts, shares(h.shares))}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {masked(hideAmounts, num(h.avg_cost))}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {num(h.price)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {masked(hideAmounts, num(h.market_value))}
                    </td>
                    <td
                      className={cn(
                        "py-2 pr-3 text-right font-mono tabular-nums",
                        hideAmounts ? undefined : plClass(h.unrealized_pl),
                      )}
                    >
                      {hideAmounts ? (
                        "••••"
                      ) : (
                        <>
                          {num(h.unrealized_pl)}
                          {h.unrealized_pl_percent != null && (
                            <span className="ml-1 text-xs">
                              {h.unrealized_pl_percent >= 0 ? "+" : ""}
                              {h.unrealized_pl_percent.toFixed(1)}%
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {h.weight == null ? "—" : `${h.weight.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
                {data.totals.cash != 0 && (
                  <tr className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{t("cash")}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      —
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      —
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      —
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {masked(hideAmounts, num(data.totals.cash))}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      —
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {data.totals.cash_weight == null
                        ? "—"
                        : `${data.totals.cash_weight.toFixed(1)}%`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
