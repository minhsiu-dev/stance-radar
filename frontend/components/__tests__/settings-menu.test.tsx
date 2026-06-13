import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { PrivacyProvider, usePrivacy } from "@/components/privacy-provider";
import { SettingsMenu } from "@/components/settings-menu";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
}));

const messages = {
  Settings: {
    open: "Settings",
    hideAmounts: "Hide amounts",
    theme: "Dark mode",
    language: "Language",
  },
};

function Probe() {
  const { hideAmounts } = usePrivacy();
  return <span data-testid="probe">{hideAmounts ? "hidden" : "shown"}</span>;
}

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ThemeProvider attribute="class">
        <PrivacyProvider>
          <SettingsMenu />
          <Probe />
        </PrivacyProvider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe("SettingsMenu", () => {
  it("toggles privacy mode and persists to localStorage", async () => {
    wrap();
    expect(screen.getByTestId("probe")).toHaveTextContent("shown");
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: /hide amounts/i }),
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("hidden");
    expect(localStorage.getItem("stance-radar-hide-amounts")).toBe("true");
  });

  it("offers theme and language items", async () => {
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText(/dark mode/i)).toBeInTheDocument();
    expect(screen.getByText("EN")).toBeInTheDocument();
    expect(screen.getByText("繁中")).toBeInTheDocument();
  });
});
