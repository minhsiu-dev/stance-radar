import { getTranslations } from "next-intl/server";
import { AutoRefreshHint } from "@/components/auto-refresh-hint";
import { ChannelLeaderboard } from "@/components/channel-leaderboard";
import { FeedList } from "@/components/feed-list";
import { PendingReviewBanner } from "@/components/pending-review-banner";
import { RefreshButton } from "@/components/refresh-button";
import { StanceFlips } from "@/components/stance-flips";
import { TrendingStocks } from "@/components/trending-stocks";

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
      <TrendingStocks />
      <StanceFlips />
      <ChannelLeaderboard />
      <FeedList />
    </div>
  );
}
