import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import { MobileNav } from "@/components/mobile-nav";

const messages = {
  Nav: {
    brand: "Stance Radar",
    home: "Home",
    trending: "Trending stocks",
    videos: "Latest videos",
    channels: "Channels",
    portfolio: "Holdings",
    openMenu: "Open menu",
  },
};

function renderNav() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MobileNav />
    </NextIntlClientProvider>,
  );
}

describe("MobileNav", () => {
  it("starts closed: nav links are not rendered", () => {
    renderNav();
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  it("opens the drawer with all five links", async () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(await screen.findByRole("link", { name: "Home" })).toBeInTheDocument();
    for (const name of [
      "Trending stocks",
      "Latest videos",
      "Channels",
      "Holdings",
    ]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("closes the drawer when a link is clicked", async () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const home = await screen.findByRole("link", { name: "Home" });
    fireEvent.click(home);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Home" })).toBeNull(),
    );
  });
});
