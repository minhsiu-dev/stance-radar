import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ChannelActivityBars } from "@/components/channel-activity-bars";
import type { WeeklyActivity } from "@/lib/types";

const messages = {
  Channels: {
    activity: { legend: "published / analyzed", tooltip: "{total} pub · {analyzed} an" },
  },
};

const WEEKLY: WeeklyActivity[] = [
  { week_start: "2026-05-18", total: 4, analyzed: 4 },
  { week_start: "2026-05-25", total: 2, analyzed: 1 },
  { week_start: "2026-06-01", total: 0, analyzed: 0 },
  { week_start: "2026-06-08", total: 5, analyzed: 0 },
  { week_start: "2026-06-15", total: 1, analyzed: 0 },
];

function wrap(weekly: WeeklyActivity[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChannelActivityBars weekly={weekly} />
    </NextIntlClientProvider>,
  );
}

describe("ChannelActivityBars", () => {
  it("scales gray bars to the busiest week and overlays analyzed in blue", () => {
    const { container } = wrap(WEEKLY);
    const gray = container.querySelectorAll<HTMLElement>('[data-testid="bar-total"]');
    const blue = container.querySelectorAll<HTMLElement>('[data-testid="bar-analyzed"]');
    expect(gray).toHaveLength(5);
    expect(gray[0].style.height).toBe("80%"); // 4/5
    expect(gray[3].style.height).toBe("100%"); // 5/5
    expect(gray[2].style.height).toBe("0%"); // empty week
    expect(blue[0].style.height).toBe("80%"); // 4/5 analyzed
    expect(blue[1].style.height).toBe("20%"); // 1/5 analyzed
    expect(blue[3].style.height).toBe("0%"); // 0 analyzed
  });

  it("renders the legend", () => {
    wrap(WEEKLY);
    expect(screen.getByText("published / analyzed")).toBeInTheDocument();
  });
});
