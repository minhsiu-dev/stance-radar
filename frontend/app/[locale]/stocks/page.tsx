import { StanceFlips } from "@/components/stance-flips";
import { TrendingStocksPage } from "@/components/trending-stocks-page";

export default function StocksIndexPage() {
  return (
    <div className="space-y-8">
      <StanceFlips />
      <TrendingStocksPage />
    </div>
  );
}
