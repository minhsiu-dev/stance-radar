import { createRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/youtube-player";

const seekTo = vi.fn();
const playVideo = vi.fn();
const playerCtor = vi.fn();

beforeEach(() => {
  seekTo.mockClear();
  playVideo.mockClear();
  playerCtor.mockClear();
  // Pre-set window.YT → the component's loadApi resolves immediately
  (window as unknown as { YT: unknown }).YT = {
    Player: class {
      constructor(el: unknown, opts: unknown) {
        playerCtor(el, opts);
      }
      seekTo = seekTo;
      playVideo = playVideo;
      destroy = vi.fn();
    },
  };
});

describe("YouTubePlayer", () => {
  it("builds a player for the given videoId and seeks via the ref", async () => {
    const ref = createRef<YouTubePlayerHandle>();
    render(<YouTubePlayer ref={ref} videoId="abc123" />);

    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    expect(playerCtor.mock.calls[0][1]).toMatchObject({ videoId: "abc123" });

    ref.current!.seekTo(42);
    expect(seekTo).toHaveBeenCalledWith(42, true);
    expect(playVideo).toHaveBeenCalled();
  });

});
