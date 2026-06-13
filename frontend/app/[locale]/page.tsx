import { PerformanceCards } from "@/components/performance-cards";
import { StanceFlips } from "@/components/stance-flips";
import { LatestVideos } from "@/components/latest-videos";

export default async function DashboardPage() {
  return (
    <div className="space-y-6">
      <PerformanceCards />
      <StanceFlips />
      <LatestVideos />
    </div>
  );
}
