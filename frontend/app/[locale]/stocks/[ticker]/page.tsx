import { StockView } from "@/components/stock-view";

export default async function StockPage({
  params,
}: {
  params: Promise<{ locale: string; ticker: string }>;
}) {
  const { ticker } = await params;
  return <StockView ticker={ticker.toUpperCase()} />;
}
