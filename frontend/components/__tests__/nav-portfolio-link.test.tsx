import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
const privacy = { locked: false };
vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => privacy,
}));

import { NavPortfolioLink } from "@/components/nav-portfolio-link";

describe("NavPortfolioLink", () => {
  it("renders the portfolio link when not hidden", () => {
    privacy.locked = false;
    render(<NavPortfolioLink className="x" />);
    expect(screen.getByText("portfolio")).toBeInTheDocument();
  });
  it("renders nothing when holdings are hidden", () => {
    privacy.locked = true;
    const { container } = render(<NavPortfolioLink className="x" />);
    expect(container).toBeEmptyDOMElement();
  });
});
