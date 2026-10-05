import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { FailedDrawer } from "@/components/pipeline/failed-drawer";
import { messages } from "./pipeline-fixtures";

vi.mock("@/components/failed-videos", () => ({
  FailedVideos: ({ kind }: { kind: string }) => <p>failed list for {kind}</p>,
}));

function renderDrawer(kind: "transcript" | "analysis" | null) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FailedDrawer kind={kind} onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("FailedDrawer", () => {
  it("opens on the lane it was asked for", async () => {
    renderDrawer("analysis");
    expect(await screen.findByRole("dialog")).toHaveTextContent("Analysis failures");
    expect(screen.getByText("failed list for analysis")).toBeInTheDocument();
  });

  it("stays closed without a kind", () => {
    renderDrawer(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
