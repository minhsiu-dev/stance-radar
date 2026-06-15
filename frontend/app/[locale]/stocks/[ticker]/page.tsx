import type { Metadata } from "next";
import { StockView } from "@/components/stock-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  return { title: ticker.toUpperCase() };
}

export default async function StockPage({
  params,
}: {
  params: Promise<{ locale: string; ticker: string }>;
}) {
  const { ticker } = await params;
  return <StockView ticker={ticker.toUpperCase()} />;
}
