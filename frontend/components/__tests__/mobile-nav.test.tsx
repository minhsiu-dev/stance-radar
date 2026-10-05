import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import { MobileNav } from "@/components/mobile-nav";

const admin = { authenticated: false };
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => admin }));

const messages = {
  Nav: {
    brand: "Stance Radar",
    home: "Home",
    trending: "Trending stocks",
    videos: "Latest videos",
    channels: "Channels",
    pipeline: "Import",
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
  beforeEach(() => {
    admin.authenticated = false;
  });

  it("starts closed: nav links are not rendered", () => {
    renderNav();
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  it("opens the drawer with all four links", async () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(await screen.findByRole("link", { name: "Home" })).toBeInTheDocument();
    for (const name of ["Trending stocks", "Latest videos", "Channels"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: "Import" })).toBeNull();
  });

  it("adds the import link once unlocked", async () => {
    admin.authenticated = true;
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(await screen.findByRole("link", { name: "Import" })).toBeInTheDocument();
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
