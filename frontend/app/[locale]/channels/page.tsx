import { getTranslations } from "next-intl/server";
import { ChannelManager } from "@/components/channel-manager";
import { AddChannelDialog } from "@/components/add-channel-dialog";
import { PendingReviewBanner } from "@/components/pending-review-banner";

export default async function ChannelsPage() {
  const t = await getTranslations("Channels");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <AddChannelDialog />
      </div>
      <PendingReviewBanner />
      <ChannelManager />
    </div>
  );
}
