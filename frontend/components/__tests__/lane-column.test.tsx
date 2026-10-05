import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { LaneColumn } from "@/components/pipeline/lane-column";
import type { PipelineLaneStage } from "@/lib/types";
import { NOW, iso, lane, messages, stage, video } from "./pipeline-fixtures";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => ({ handleAuthError: vi.fn() }) }));

function renderColumn(value: PipelineLaneStage) {
  const onOpenFailed = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LaneColumn
        name="analysis"
        lane={lane()}
        stage={value}
        now={NOW}
        onChanged={vi.fn()}
        onOpenFailed={onOpenFailed}
      />
    </NextIntlClientProvider>,
  );
  return onOpenFailed;
}

describe("LaneColumn", () => {
  it("lists processing videos with their elapsed time, then the queue", () => {
    renderColumn(
      stage({
        queued: 3,
        processing: [video("busy", { claimed_at: iso(12_000) })],
        next: [video("q1"), video("q2")],
      }),
    );
    const column = screen.getByRole("region", { name: "③ Analysis" });
    expect(column).toHaveTextContent("4"); // queued + processing
    expect(screen.getByText("Processing (1)")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-video-busy")).toHaveTextContent("12s");
    expect(screen.getByText("Queued (3)")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-video-q1")).toBeInTheDocument();
    expect(screen.getByText("1 more")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Video q1" })).toHaveAttribute("href", "/videos/q1");
  });

  it("says idle when nothing is queued or running", () => {
    renderColumn(stage());
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("opens the failure drawer from the failed count", async () => {
    const onOpenFailed = renderColumn(stage({ failed: 7 }));
    await userEvent.click(screen.getByRole("button", { name: /7 failed/ }));
    expect(onOpenFailed).toHaveBeenCalled();
  });

  it("hides the failure entry when nothing failed", () => {
    renderColumn(stage({ queued: 1, next: [video("q1")] }));
    expect(screen.queryByRole("button", { name: /failed/ })).toBeNull();
  });
});
