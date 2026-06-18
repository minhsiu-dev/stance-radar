import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
const privacy = { hideHoldings: false, ready: true, toggle: vi.fn() };
vi.mock("@/components/privacy-provider", () => ({ usePrivacy: () => privacy }));

import { PortfolioGate } from "@/components/portfolio-gate";

describe("PortfolioGate", () => {
  it("renders children when not hidden", () => {
    Object.assign(privacy, { hideHoldings: false, ready: true });
    render(<PortfolioGate><div data-testid="body" /></PortfolioGate>);
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });
  it("shows the hidden placeholder + Show holdings button when hidden", () => {
    privacy.toggle = vi.fn();
    Object.assign(privacy, { hideHoldings: true, ready: true });
    render(<PortfolioGate><div data-testid="body" /></PortfolioGate>);
    expect(screen.queryByTestId("body")).not.toBeInTheDocument();
    expect(screen.getByTestId("holdings-hidden")).toBeInTheDocument();
    fireEvent.click(screen.getByText("showHoldings"));
    expect(privacy.toggle).toHaveBeenCalled();
  });
  it("renders neither body nor placeholder before ready", () => {
    Object.assign(privacy, { hideHoldings: true, ready: false });
    render(<PortfolioGate><div data-testid="body" /></PortfolioGate>);
    expect(screen.queryByTestId("body")).not.toBeInTheDocument();
    expect(screen.queryByTestId("holdings-hidden")).not.toBeInTheDocument();
  });
});
