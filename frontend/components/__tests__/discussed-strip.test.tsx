import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { DiscussedStrip } from "@/components/discussed-strip";

const messages = { Dashboard: { discussed: { title: "Most discussed" } } };

const STOCKS = [
  { ticker: "NVDA", channel_count: 4, mention_count: 7, score: 1, last_mentioned_at: "2026-06-11T00:00:00Z" },
  { ticker: "AAPL", channel_count: 2, mention_count: 5, score: 1, last_mentioned_at: "2026-06-10T00:00:00Z" },
];

function wrap(selected: string[], onToggle: (t: string) => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher: vi.fn().mockResolvedValue(STOCKS), provider: () => new Map() }}>
        <DiscussedStrip selected={selected} onToggle={onToggle} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("DiscussedStrip", () => {
  it("renders a chip per stock with its channel count and toggles on click", async () => {
    const onToggle = vi.fn();
    wrap([], onToggle);
    const chips = await screen.findAllByTestId("discussed-chip");
    expect(chips[0].textContent).toContain("NVDA");
    expect(chips[0].textContent).toContain("4");
    fireEvent.click(chips[0]);
    expect(onToggle).toHaveBeenCalledWith("NVDA");
  });

  it("marks selected chips as pressed", async () => {
    wrap(["AAPL"], vi.fn());
    const aapl = (await screen.findAllByTestId("discussed-chip")).find((c) =>
      c.textContent?.includes("AAPL"),
    );
    expect(aapl?.getAttribute("aria-pressed")).toBe("true");
  });
});
