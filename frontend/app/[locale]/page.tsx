import { getTranslations } from "next-intl/server";
import { PerformanceCards } from "@/components/performance-cards";
import { RecentStocks } from "@/components/recent-stocks";
import { LatestVideos } from "@/components/latest-videos";

export default async function DashboardPage() {
  const t = await getTranslations("Nav");
  return (
    <div className="space-y-6">
      <h1 className="sr-only">{t("home")}</h1>
      <PerformanceCards />
      <RecentStocks />
      <LatestVideos />
    </div>
  );
}
