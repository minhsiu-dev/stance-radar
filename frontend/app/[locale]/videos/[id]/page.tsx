import { VideoDetail } from "@/components/video-detail";

export default async function VideoPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  return <VideoDetail videoId={id} />;
}
