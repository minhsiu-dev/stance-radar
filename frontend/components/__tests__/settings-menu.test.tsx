import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { SettingsMenu } from "@/components/settings-menu";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
}));

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));
// The dialog is presentational and mounted by SettingsMenu; stub it so this test
// stays focused on the menu item (the dialog + provider are covered elsewhere).
vi.mock("@/components/unlock-dialog", () => ({ UnlockDialog: () => null }));

const messages = {
  Settings: { open: "Settings", theme: "Dark mode", language: "Language" },
  Admin: { unlockAria: "Unlock admin actions", lockAria: "Lock admin actions" },
};

function adminState(overrides = {}) {
  return {
    ready: true,
    enabled: false,
    authenticated: false,
    dialogOpen: false,
    setDialogOpen: vi.fn(),
    promptUnlock: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
    ...overrides,
  };
}

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ThemeProvider attribute="class">
        <SettingsMenu />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => useAdmin.mockReset());

describe("SettingsMenu", () => {
  it("shows theme and language; no admin lock item when the feature is disabled", async () => {
    useAdmin.mockReturnValue(adminState({ enabled: false }));
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText(/dark mode/i)).toBeInTheDocument();
    expect(screen.getByText("EN")).toBeInTheDocument();
    expect(screen.queryByText(/admin actions/i)).toBeNull();
  });

  it("shows an unlock item when locked, and clicking it prompts for the password", async () => {
    const state = adminState({ enabled: true, authenticated: false });
    useAdmin.mockReturnValue(state);
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    const item = await screen.findByText("Unlock admin actions");
    await userEvent.click(item);
    expect(state.promptUnlock).toHaveBeenCalled();
    expect(state.lock).not.toHaveBeenCalled();
  });

  it("shows a lock item when unlocked, and clicking it locks", async () => {
    const state = adminState({ enabled: true, authenticated: true });
    useAdmin.mockReturnValue(state);
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    const item = await screen.findByText("Lock admin actions");
    await userEvent.click(item);
    expect(state.lock).toHaveBeenCalled();
    expect(state.promptUnlock).not.toHaveBeenCalled();
  });
});
