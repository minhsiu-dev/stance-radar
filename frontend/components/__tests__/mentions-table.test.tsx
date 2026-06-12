import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));
vi.mock("swr", () => ({
  default: () => ({
    data: [
      {
        video_id: "vid-1",
        video_title: "V",
        channel_id: "c",
        channel_title: "Ch",
        published_at: "2026-01-02T12:00:00Z",
        start_seconds: 0,
        quote: "q",
        stance: "buy",
        reasoning: "r",
        youtube_url: "https://yt/v",
      },
    ],
    isLoading: false,
    error: undefined,
  }),
}));

import { MentionsTable } from "@/components/mentions-table";

describe("MentionsTable hover", () => {
  it("invokes onRowHover with video_id on mouseEnter / null on leave", () => {
    const onRowHover = vi.fn();
    render(
      <MentionsTable
        ticker="AAPL"
        selectedVideoId={null}
        onRowHover={onRowHover}
      />,
    );
    const row = screen.getByText("V").closest("tr")!;
    fireEvent.mouseEnter(row);
    expect(onRowHover).toHaveBeenLastCalledWith("vid-1");
    fireEvent.mouseLeave(row);
    expect(onRowHover).toHaveBeenLastCalledWith(null);
  });
});
