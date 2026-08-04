import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

import { TrackRecordTickerPicker } from "@/components/track-record-ticker-picker";

const AVAILABLE = [
  { ticker: "NVDA", calls: 30 },
  { ticker: "TSM", calls: 19 },
  { ticker: "AVGO", calls: 18 },
  { ticker: "PLTR", calls: 10 },
];

const onToggle = vi.fn();

function renderPicker(selected: string[], max = 10) {
  return render(
    <TrackRecordTickerPicker
      available={AVAILABLE}
      selected={selected}
      max={max}
      colorOf={(t) => (selected.includes(t) ? "#2a78d6" : null)}
      onToggle={onToggle}
    />,
  );
}

function open() {
  fireEvent.click(screen.getByTestId("track-picker-trigger"));
}

describe("TrackRecordTickerPicker", () => {
  beforeEach(() => onToggle.mockClear());

  it("lists every available ticker with its call count, in the given order", () => {
    renderPicker(["NVDA"]);
    open();
    const rows = screen.getAllByTestId(/^track-picker-option-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "track-picker-option-NVDA",
      "track-picker-option-TSM",
      "track-picker-option-AVGO",
      "track-picker-option-PLTR",
    ]);
    // 次數顯示在每一列右邊
    expect(screen.getByTestId("track-picker-count-NVDA")).toHaveTextContent("30");
    expect(screen.getByTestId("track-picker-count-PLTR")).toHaveTextContent("10");
  });

  it("offers a ticker that the old top-ten cut would have excluded", () => {
    renderPicker(["NVDA"]);
    open();
    fireEvent.click(screen.getByTestId("track-picker-option-PLTR"));
    expect(onToggle).toHaveBeenCalledWith("PLTR");
  });

  it("filters the list by the search query", () => {
    renderPicker(["NVDA"]);
    open();
    fireEvent.change(screen.getByTestId("track-picker-search"), {
      target: { value: "PL" },
    });
    expect(screen.queryByTestId("track-picker-option-NVDA")).toBeNull();
    expect(screen.getByTestId("track-picker-option-PLTR")).toBeInTheDocument();
  });

  it("disables the unselected options once the cap is reached", () => {
    renderPicker(["NVDA", "TSM"], 2);
    open();
    expect(screen.getByTestId("track-picker-option-PLTR")).toHaveAttribute(
      "data-disabled",
    );
    // 已選的仍然可以點（那是取消選取，不受上限影響）
    expect(screen.getByTestId("track-picker-option-NVDA")).not.toHaveAttribute(
      "data-disabled",
    );
  });

  it("shows the selected count and the cap on the trigger", () => {
    renderPicker(["NVDA", "TSM"], 10);
    expect(screen.getByTestId("track-picker-trigger")).toHaveTextContent(
      'picker.trigger:{"n":2,"max":10}',
    );
  });

  it("renders an empty message when nothing matches", () => {
    renderPicker(["NVDA"]);
    open();
    fireEvent.change(screen.getByTestId("track-picker-search"), {
      target: { value: "zzz" },
    });
    expect(screen.getByTestId("track-picker-empty")).toBeInTheDocument();
  });
});
