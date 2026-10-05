import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { DoneColumn } from "@/components/pipeline/done-column";
import type { PipelineSnapshot } from "@/lib/types";
import { NOW, doneVideo, iso, messages } from "./pipeline-fixtures";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderDone(done: PipelineSnapshot["stages"]["done"]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DoneColumn done={done} now={NOW} />
    </NextIntlClientProvider>,
  );
}

describe("DoneColumn", () => {
  it("shows analyzed videos with their calls and no-transcript ones greyed out", () => {
    renderDone({
      total: 3,
      items: [
        doneVideo("a", {
          finished_at: iso(120_000),
          stances: [
            { ticker: "NVDA", stance: "buy" },
            { ticker: "TSLA", stance: "sell" },
          ],
        }),
        doneVideo("n", { status: "no_transcript" }),
      ],
    });
    expect(screen.getByRole("region", { name: "Just finished" })).toHaveTextContent("3");
    const analyzed = screen.getByTestId("pipeline-video-a");
    expect(analyzed).toHaveTextContent("NVDA");
    expect(analyzed).toHaveTextContent("TSLA");
    expect(analyzed).toHaveTextContent("2m0s ago");
    expect(screen.getByTestId("pipeline-video-n")).toHaveTextContent("No transcript");
    expect(screen.getByText("1 more")).toBeInTheDocument();
  });

  it("has an empty state", () => {
    renderDone({ total: 0, items: [] });
    expect(screen.getByText("Nothing finished in the last 24 hours")).toBeInTheDocument();
  });
});
