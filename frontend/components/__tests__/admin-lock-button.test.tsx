import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { AdminLockButton } from "@/components/admin-lock-button";

describe("AdminLockButton", () => {
  it("renders nothing until session is ready", () => {
    useAdmin.mockReturnValue({ ready: false, enabled: true, authenticated: false });
    const { container } = render(<AdminLockButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hidden when admin lock is disabled (no password configured)", () => {
    useAdmin.mockReturnValue({ ready: true, enabled: false, authenticated: false });
    const { container } = render(<AdminLockButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows unlock affordance when locked", () => {
    useAdmin.mockReturnValue({
      ready: true, enabled: true, authenticated: false, promptUnlock: vi.fn(),
    });
    render(<AdminLockButton />);
    expect(screen.getByLabelText("unlockAria")).toBeInTheDocument();
  });

  it("shows lock affordance when unlocked", () => {
    useAdmin.mockReturnValue({
      ready: true, enabled: true, authenticated: true, lock: vi.fn(),
    });
    render(<AdminLockButton />);
    expect(screen.getByLabelText("lockAria")).toBeInTheDocument();
  });
});
