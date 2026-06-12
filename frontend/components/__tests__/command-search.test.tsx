import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("swr", () => ({
  default: () => ({ data: undefined, error: undefined }),
}));

import { CommandSearch } from "@/components/command-search";

beforeEach(() => {
  push.mockReset();
  localStorage.clear();
});

describe("CommandSearch", () => {
  it("opens on ⌘K", async () => {
    render(<CommandSearch />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await waitFor(() =>
      expect(screen.getAllByPlaceholderText("placeholder").length).toBeGreaterThan(0),
    );
  });

  it("persists recent visits and shows them when input is empty", async () => {
    localStorage.setItem(
      "stance-radar-recent-tickers",
      JSON.stringify(["NVDA", "TSLA"]),
    );
    render(<CommandSearch />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await waitFor(() => expect(screen.getByText("NVDA")).toBeInTheDocument());
    expect(screen.getByText("TSLA")).toBeInTheDocument();
  });

  it("navigates and writes to Recent on select", async () => {
    localStorage.setItem(
      "stance-radar-recent-tickers",
      JSON.stringify(["NVDA"]),
    );
    render(<CommandSearch />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.click(await screen.findByText("NVDA"));
    expect(push).toHaveBeenCalledWith("/en/stocks/NVDA");
    expect(
      JSON.parse(localStorage.getItem("stance-radar-recent-tickers")!)[0],
    ).toBe("NVDA");
  });
});
