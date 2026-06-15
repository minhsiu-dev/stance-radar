import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StanceFlips } from "@/components/stance-flips";
import { TrendingStocksPage } from "@/components/trending-stocks-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Nav" });
  return { title: t("trending") };
}

export default async function StocksIndexPage() {
  const t = await getTranslations("Nav");
  return (
    <div className="space-y-8">
      <h1 className="sr-only">{t("trending")}</h1>
      <StanceFlips />
      <TrendingStocksPage />
    </div>
  );
}
