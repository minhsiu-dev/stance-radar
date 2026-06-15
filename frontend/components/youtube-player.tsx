"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

export interface YouTubePlayerHandle {
  seekTo: (seconds: number) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type YT = any;

declare global {
  interface Window {
    YT?: YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

// Load iframe_api only once globally; resolve immediately if already loaded
function loadApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, { videoId: string }>(
  function YouTubePlayer({ videoId }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<YT>(null);

    useEffect(() => {
      let cancelled = false;
      loadApi().then(() => {
        if (cancelled || !containerRef.current || !window.YT) return;
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId,
          playerVars: { playsinline: 1, rel: 0 },
        });
      });
      return () => {
        cancelled = true;
        playerRef.current?.destroy?.();
        playerRef.current = null;
      };
    }, [videoId]);

    useImperativeHandle(
      ref,
      () => ({
        seekTo: (seconds: number) => {
          playerRef.current?.seekTo?.(seconds, true);
          playerRef.current?.playVideo?.();
        },
      }),
      [],
    );

    return (
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
        <div ref={containerRef} data-testid="yt-player" className="h-full w-full" />
      </div>
    );
  },
);
