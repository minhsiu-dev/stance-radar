import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";

const envelopeSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
  apiFetchEnvelope: (...args: unknown[]) => envelopeSpy(...args),
}));

const useAdmin = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => useAdmin() }));

import { HoldingsDialog } from "@/components/holdings-dialog";

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
  envelopeSpy.mockReset();
});

const messages = {
  Holdings: {
    manage: "Manage holdings",
    title: "My holdings",
    placeholder: "Paste symbols, separated by spaces or commas",
    add: "Add",
    empty: "No holdings recorded yet",
    remove: "Remove",
    added: "Added: {names}",
    skipped: "Already there: {names}",
    failed: "Could not add",
  },
};

function wrap(fetcher: (url: string) => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <HoldingsDialog />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("HoldingsDialog", () => {
  it("renders nothing while locked", () => {
    useAdmin.mockReturnValue({ authenticated: false, handleAuthError: vi.fn() });
    const { container } = wrap(vi.fn().mockResolvedValue([]));
    expect(container).toBeEmptyDOMElement();
  });

  it("lists current holdings and submits new ones uppercased by the server", async () => {
    envelopeSpy.mockResolvedValue({ status: 200, body: { data: { added: ["AAPL", "MSFT"], skipped: [] } } });
    wrap(vi.fn().mockResolvedValue([{ ticker: "GOOG", added_at: "2026-08-01T00:00:00Z", note: null }]));

    fireEvent.click(screen.getByRole("button", { name: "Manage holdings" }));
    expect(await screen.findByText("GOOG")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Paste symbols/i), {
      target: { value: "aapl msft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(envelopeSpy).toHaveBeenCalledWith(
        "/api/holdings",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const [, opts] = envelopeSpy.mock.calls[0];
    expect(JSON.parse((opts as { body: string }).body)).toEqual({ tickers: "aapl msft" });
  });

  it("removes a holding", async () => {
    envelopeSpy.mockResolvedValue({ status: 200, body: { data: { ticker: "GOOG" } } });
    wrap(vi.fn().mockResolvedValue([{ ticker: "GOOG", added_at: "2026-08-01T00:00:00Z", note: null }]));

    fireEvent.click(screen.getByRole("button", { name: "Manage holdings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove GOOG" }));

    await waitFor(() =>
      expect(envelopeSpy).toHaveBeenCalledWith(
        "/api/holdings/GOOG",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
