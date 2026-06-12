import { ChannelDetail } from "@/components/channel-detail";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  return <ChannelDetail channelId={id} />;
}
