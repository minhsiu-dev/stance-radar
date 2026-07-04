import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
const privacy = { locked: false, ready: true };
vi.mock("@/components/privacy-provider", () => ({ usePrivacy: () => privacy }));
vi.mock("@/components/unlock-dialog", () => ({
  UnlockDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="unlock-dialog" /> : null,
}));

import { PortfolioGate } from "@/components/portfolio-gate";

describe("PortfolioGate", () => {
  it("renders children when unlocked", () => {
    Object.assign(privacy, { locked: false, ready: true });
    render(<PortfolioGate><div data-testid="body" /></PortfolioGate>);
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });
  it("shows the lock screen and opens the unlock dialog when locked", () => {
    Object.assign(privacy, { locked: true, ready: true });
    render(<PortfolioGate><div data-testid="body" /></PortfolioGate>);
    expect(screen.queryByTestId("body")).not.toBeInTheDocument();
    expect(screen.getByTestId("holdings-hidden")).toBeInTheDocument();
    expect(screen.queryByTestId("unlock-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("unlock"));
    expect(screen.getByTestId("unlock-dialog")).toBeInTheDocument();
  });
  it("renders neither body nor lock screen before ready", () => {
    Object.assign(privacy, { locked: true, ready: false });
    render(<PortfolioGate><div data-testid="body" /></PortfolioGate>);
    expect(screen.queryByTestId("body")).not.toBeInTheDocument();
    expect(screen.queryByTestId("holdings-hidden")).not.toBeInTheDocument();
  });
});
