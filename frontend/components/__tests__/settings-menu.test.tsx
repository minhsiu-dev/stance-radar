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

const messages = {
  Settings: {
    open: "Settings",
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
  it("shows theme and language, and no holdings lock item", async () => {
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText(/dark mode/i)).toBeInTheDocument();
    expect(screen.getByText("EN")).toBeInTheDocument();
    expect(screen.queryByText(/holdings/i)).toBeNull();
  });
});
