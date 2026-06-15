import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AutoRefreshHint } from "@/components/auto-refresh-hint";
import { FeedSection } from "@/components/feed-section";
import { PendingReviewBanner } from "@/components/pending-review-banner";
import { RefreshButton } from "@/components/refresh-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Nav" });
  return { title: t("videos") };
}

export default async function VideosPage() {
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
      <FeedSection />
    </div>
  );
}
