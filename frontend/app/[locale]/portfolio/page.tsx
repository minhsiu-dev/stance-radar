import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PerformanceCards } from "@/components/performance-cards";
import { PortfolioChart } from "@/components/portfolio-chart";
import { PortfolioCategories } from "@/components/portfolio-categories";
import { PortfolioHoldingsTable } from "@/components/portfolio-holdings-table";
import { PortfolioSummary } from "@/components/portfolio-summary";
import { PortfolioTransactions } from "@/components/portfolio-transactions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PortfolioGate } from "@/components/portfolio-gate";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Nav" });
  return { title: t("portfolio") };
}

export default async function PortfolioPage() {
  const t = await getTranslations("Portfolio");

  return (
    <PortfolioGate>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <PerformanceCards />
        <PortfolioSummary />
        <PortfolioChart />
        <Tabs defaultValue="detail">
          <TabsList>
            <TabsTrigger value="detail">{t("categories.detailTab")}</TabsTrigger>
            <TabsTrigger value="categories">{t("categories.categoriesTab")}</TabsTrigger>
          </TabsList>
          <TabsContent value="detail">
            <PortfolioHoldingsTable />
          </TabsContent>
          <TabsContent value="categories">
            <PortfolioCategories />
          </TabsContent>
        </Tabs>
        <PortfolioTransactions />
      </div>
    </PortfolioGate>
  );
}
