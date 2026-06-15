import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ChannelActivityBars } from "@/components/channel-activity-bars";
import type { WeeklyActivity } from "@/lib/types";

const messages = {
  Channels: {
    activity: {
      legend: "published / analyzed",
      tooltip: "{total} pub · {analyzed} an",
      weekOf: "Week of {date}",
    },
  },
};

// Baseline is a fixed 7 videos/week (full bar). Busy weeks clip to 100%.
const WEEKLY: WeeklyActivity[] = [
  { week_start: "2026-05-18", total: 4, analyzed: 4 },
  { week_start: "2026-05-25", total: 2, analyzed: 1 },
  { week_start: "2026-06-01", total: 0, analyzed: 0 },
  { week_start: "2026-06-08", total: 9, analyzed: 3 }, // > baseline → clamps
  { week_start: "2026-06-15", total: 7, analyzed: 5 }, // == baseline → full
];

function wrap(weekly: WeeklyActivity[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChannelActivityBars weekly={weekly} />
    </NextIntlClientProvider>,
  );
}

describe("ChannelActivityBars", () => {
  it("scales bars to a fixed weekly baseline and clamps busy weeks", () => {
    const { container } = wrap(WEEKLY);
    const gray = container.querySelectorAll<HTMLElement>('[data-testid="bar-total"]');
    const blue = container.querySelectorAll<HTMLElement>('[data-testid="bar-analyzed"]');
    expect(gray).toHaveLength(5);
    // total relative to baseline 7
    expect(parseFloat(gray[0].style.height)).toBeCloseTo((4 / 7) * 100, 4);
    expect(gray[2].style.height).toBe("0%"); // empty week
    expect(gray[3].style.height).toBe("100%"); // 9 > 7 → clamp
    expect(gray[4].style.height).toBe("100%"); // 7 == 7 → full
    // analyzed overlay also relative to baseline 7
    expect(parseFloat(blue[0].style.height)).toBeCloseTo((4 / 7) * 100, 4);
    expect(parseFloat(blue[3].style.height)).toBeCloseTo((3 / 7) * 100, 4);
    expect(blue[2].style.height).toBe("0%");
  });

  it("renders the legend", () => {
    wrap(WEEKLY);
    expect(screen.getByText("published / analyzed")).toBeInTheDocument();
  });
});
