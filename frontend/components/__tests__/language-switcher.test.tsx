import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

const replace = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/stocks/AAPL",
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
}));

import { LanguageSwitcher } from "@/components/language-switcher";

describe("LanguageSwitcher", () => {
  it("replaces with target locale and preserves path", async () => {
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(await screen.findByText("繁中"));
    expect(replace).toHaveBeenCalledWith("/stocks/AAPL", { locale: "zh-TW" });
  });
});
