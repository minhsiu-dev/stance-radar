import { FeedList } from "@/components/feed-list";
import { RefreshButton } from "@/components/refresh-button";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">最新影片</h1>
        <RefreshButton />
      </div>
      <FeedList />
    </div>
  );
}
