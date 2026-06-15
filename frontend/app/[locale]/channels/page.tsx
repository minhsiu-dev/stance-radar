import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ChannelManager } from "@/components/channel-manager";
import { AddChannelDialog } from "@/components/add-channel-dialog";
import { PendingReviewBanner } from "@/components/pending-review-banner";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Nav" });
  return { title: t("channels") };
}

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
