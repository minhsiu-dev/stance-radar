"use client";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { PipelineVideo } from "@/lib/types";

/** One compact video line, shared by every pipeline column. */
export function PipelineVideoRow({
  video,
  meta,
  highlight = false,
  muted = false,
  children,
}: {
  video: PipelineVideo;
  meta?: React.ReactNode;
  highlight?: boolean;
  muted?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid={`pipeline-video-${video.id}`}
      className={cn(
        "flex items-start gap-2 rounded-md border bg-card px-2 py-1.5 text-xs",
        highlight && "border-primary ring-1 ring-inset ring-primary",
        muted && "opacity-70",
      )}
    >
      {video.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={video.thumbnail_url}
          alt=""
          className="mt-0.5 h-6 w-10 shrink-0 rounded object-cover"
        />
      ) : (
        <div aria-hidden className="mt-0.5 h-6 w-10 shrink-0 rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <Link
          href={`/videos/${video.id}`}
          className="block truncate font-medium hover:underline"
        >
          {video.title}
        </Link>
        <span className="block truncate text-muted-foreground">
          {video.channel.title}
          {meta ? <> · {meta}</> : null}
        </span>
        {children}
      </div>
    </div>
  );
}
