import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { FailedVideosLink } from "@/components/failed-videos-link";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));

const messages = { Failed: { link: "{count} failed" } };

function renderLink(total: number) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig
        value={{
          fetcher: async () => ({ total, groups: [], channels: [] }),
          provider: () => new Map(),
        }}
      >
        <FailedVideosLink />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true });
});

describe("FailedVideosLink", () => {
  it("links to /failed with the failure count", async () => {
    renderLink(213);
    expect(await screen.findByText("213 failed")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/failed");
  });

  it("renders nothing when there are no failures", async () => {
    renderLink(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing when not authenticated", async () => {
    useAdmin.mockReturnValue({ authenticated: false });
    renderLink(213);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
