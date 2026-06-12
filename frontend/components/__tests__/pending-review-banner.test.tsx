import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    // 等 SWR resolve 後仍不該出現
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
