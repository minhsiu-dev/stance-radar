import { ChannelManager } from "@/components/channel-manager";

export default function ChannelsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">頻道管理</h1>
      <ChannelManager />
    </div>
  );
}
