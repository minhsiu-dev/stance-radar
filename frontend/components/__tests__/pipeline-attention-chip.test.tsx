import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PipelineAttentionChip } from "@/components/pipeline-attention-chip";
import type { PipelineSnapshot } from "@/lib/types";
import { messages, snapshot } from "./pipeline-fixtures";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const admin = { authenticated: true };
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => admin }));

function renderChip(data: PipelineSnapshot) {
  const fetcher = vi.fn(() => Promise.resolve(data));
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <PipelineAttentionChip />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return fetcher;
}

describe("PipelineAttentionChip", () => {
  it("sums up what needs the operator and links to the import page", async () => {
    admin.authenticated = true;
    renderChip(
      snapshot({
        select: 2,
        transcript: { failed: 1 },
        analysis: { failed: 2 },
        lanes: { analysis: { paused: true } },
      }),
    );
    const chip = await screen.findByRole("link");
    expect(chip).toHaveAttribute("href", "/pipeline");
    expect(chip).toHaveTextContent("Import: 2 to decide · 3 failed · Analysis paused");
  });

  it("names an offline lane", async () => {
    admin.authenticated = true;
    renderChip(snapshot({ lanes: { transcript: { online: false } } }));
    expect(await screen.findByRole("link")).toHaveTextContent("Transcripts offline");
  });

  it("stays out of the way when nothing needs attention", async () => {
    admin.authenticated = true;
    const fetcher = renderChip(snapshot({ transcript: { queued: 5 } }));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("never fetches while locked", () => {
    admin.authenticated = false;
    const fetcher = renderChip(snapshot({ select: 2 }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
