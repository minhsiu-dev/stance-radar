import { getTranslations } from "next-intl/server";
import { PortfolioChart } from "@/components/portfolio-chart";
import { PortfolioHoldingsTable } from "@/components/portfolio-holdings-table";
import { PortfolioSummary } from "@/components/portfolio-summary";
import { PortfolioTransactions } from "@/components/portfolio-transactions";

export default async function PortfolioPage() {
  const t = await getTranslations("Portfolio");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <PortfolioSummary />
      <PortfolioChart />
      <PortfolioHoldingsTable />
      <PortfolioTransactions />
    </div>
  );
}
