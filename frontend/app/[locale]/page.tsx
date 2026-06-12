import { getTranslations } from "next-intl/server";
import { FeedList } from "@/components/feed-list";
import { PendingReviewBanner } from "@/components/pending-review-banner";
import { RefreshButton } from "@/components/refresh-button";
import { TrendingStocks } from "@/components/trending-stocks";

export default async function DashboardPage() {
  const t = await getTranslations("Dashboard");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("latest")}</h1>
        <RefreshButton />
      </div>
      <PendingReviewBanner />
      <TrendingStocks />
      <FeedList />
    </div>
  );
}
