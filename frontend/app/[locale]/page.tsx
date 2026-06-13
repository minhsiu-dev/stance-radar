import { getTranslations } from "next-intl/server";
import { AutoRefreshHint } from "@/components/auto-refresh-hint";
import { FeedSection } from "@/components/feed-section";
import { PendingReviewBanner } from "@/components/pending-review-banner";
import { PerformanceCards } from "@/components/performance-cards";
import { RefreshButton } from "@/components/refresh-button";
import { StanceFlips } from "@/components/stance-flips";

export default async function DashboardPage() {
  const t = await getTranslations("Dashboard");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("latest")}</h1>
        <div className="flex items-center gap-3">
          <AutoRefreshHint />
          <RefreshButton />
        </div>
      </div>
      <PendingReviewBanner />
      <PerformanceCards />
      <StanceFlips />
      <FeedSection />
    </div>
  );
}
