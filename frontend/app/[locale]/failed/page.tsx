import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FailedVideos } from "@/components/failed-videos";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Failed" });
  return { title: t("title") };
}

export default async function FailedPage() {
  const t = await getTranslations("Failed");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <FailedVideos />
    </div>
  );
}
