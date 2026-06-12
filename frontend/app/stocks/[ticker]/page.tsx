import { StockView } from "@/components/stock-view";

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  return <StockView ticker={ticker.toUpperCase()} />;
}
