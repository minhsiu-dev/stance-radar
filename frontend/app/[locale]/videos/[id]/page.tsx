import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { VideoDetail } from "@/components/video-detail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return { title: t("video") };
}

export default async function VideoPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  return <VideoDetail videoId={id} />;
}
