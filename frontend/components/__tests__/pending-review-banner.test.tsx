import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PendingReviewBanner } from "@/components/pending-review-banner";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
});

const messages = {
  Review: {
    banner: "{count} videos awaiting review",
    bannerCta: "Review now",
  },
};

function renderBanner(total: number) {
  const fetcher = vi.fn().mockResolvedValue({ total, groups: [] });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <PendingReviewBanner />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("PendingReviewBanner", () => {
  it("links to /review when videos await review", async () => {
    renderBanner(4);
    expect(
      await screen.findByText("4 videos awaiting review"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/review");
  });

  it("renders nothing when there is nothing to review", async () => {
    renderBanner(0);
    // Should still not appear after SWR resolves
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing when not authenticated, even with videos awaiting review", async () => {
    useAdmin.mockReturnValue({ authenticated: false, handleAuthError: vi.fn() });
    renderBanner(4);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
