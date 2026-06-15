import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ChannelDetail } from "@/components/channel-detail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return { title: t("channel") };
}

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  return <ChannelDetail channelId={id} />;
}
