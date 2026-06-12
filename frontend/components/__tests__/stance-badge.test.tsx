import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StanceBadge } from "@/components/stance-badge";

describe("StanceBadge", () => {
  it("renders ticker with stance label", () => {
    render(<StanceBadge stance="buy" ticker="AAPL" />);
    expect(screen.getByText("AAPL · Buy")).toBeInTheDocument();
  });

  it("renders label only when no ticker", () => {
    render(<StanceBadge stance="sell" />);
    expect(screen.getByText("Sell")).toBeInTheDocument();
  });

  it("applies stance-specific color class", () => {
    render(<StanceBadge stance="buy" />);
    expect(screen.getByText("Buy").className).toContain("text-green");
  });
});
