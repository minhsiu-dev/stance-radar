import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { SettingsMenu } from "@/components/settings-menu";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/components/unlock-dialog", () => ({
  UnlockDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="unlock-dialog" /> : null,
}));

const privacy = { enabled: false, authenticated: false, lock: vi.fn() };
vi.mock("@/components/privacy-provider", () => ({ usePrivacy: () => privacy }));

const messages = {
  Settings: {
    open: "Settings",
    lockHoldings: "Lock holdings",
    unlockHoldings: "Unlock holdings",
    theme: "Dark mode",
    language: "Language",
  },
};

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ThemeProvider attribute="class">
        <SettingsMenu />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

describe("SettingsMenu", () => {
  it("shows a Lock item that locks when unlocked+enabled", async () => {
    Object.assign(privacy, { enabled: true, authenticated: true, lock: vi.fn() });
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(await screen.findByText("Lock holdings"));
    expect(privacy.lock).toHaveBeenCalled();
  });

  it("shows an Unlock item that opens the dialog when locked", async () => {
    Object.assign(privacy, { enabled: true, authenticated: false, lock: vi.fn() });
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(await screen.findByText("Unlock holdings"));
    expect(screen.getByTestId("unlock-dialog")).toBeInTheDocument();
  });

  it("hides the lock item when the feature is disabled, keeps theme + language", async () => {
    Object.assign(privacy, { enabled: false, authenticated: false, lock: vi.fn() });
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByText("Lock holdings")).toBeNull();
    expect(screen.queryByText("Unlock holdings")).toBeNull();
    expect(await screen.findByText(/dark mode/i)).toBeInTheDocument();
    expect(screen.getByText("EN")).toBeInTheDocument();
  });
});
