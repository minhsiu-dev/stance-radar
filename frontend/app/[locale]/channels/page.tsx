import { getTranslations } from "next-intl/server";
import { ChannelManager } from "@/components/channel-manager";
import { PendingReviewBanner } from "@/components/pending-review-banner";

export default async function ChannelsPage() {
  const t = await getTranslations("Channels");

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <PendingReviewBanner />
      <ChannelManager />
    </div>
  );
}
