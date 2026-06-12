"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import type { NewsResponse } from "@/lib/types";

export function NewsCard() {
  const t = useTranslations("Dashboard.news");
  const { data, error } = useSWR<NewsResponse>("/api/news");

  if (error) return null; // 新聞非核心,失敗就整塊收起
  if (!data) return <Skeleton className="h-40 w-full" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {data.scope === "holdings" ? t("title") : t("generalTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}
        {data.items.map((n) => (
          <div key={n.url} className="flex items-start gap-2 text-sm">
            <Badge variant="outline" className="mt-0.5 shrink-0 px-1.5 text-[11px]">
              {n.ticker}
            </Badge>
            <div className="min-w-0">
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer"
                className="line-clamp-1 hover:underline"
              >
                {n.title}
              </a>
              <p className="text-xs text-muted-foreground">
                {n.publisher && <span>{n.publisher}</span>}
                {n.publisher && <span className="mx-1 opacity-60">·</span>}
                <span>{formatDate(n.published_at)}</span>
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
