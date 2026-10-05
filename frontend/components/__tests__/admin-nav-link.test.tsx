import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminNavLink } from "@/components/admin-nav-link";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const admin = { authenticated: false };
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => admin }));

describe("AdminNavLink", () => {
  it("renders nothing while locked", () => {
    admin.authenticated = false;
    render(<AdminNavLink href="/pipeline" label="Import" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders the link once unlocked", () => {
    admin.authenticated = true;
    render(<AdminNavLink href="/pipeline" label="Import" />);
    expect(screen.getByRole("link", { name: "Import" })).toHaveAttribute("href", "/pipeline");
  });
});
