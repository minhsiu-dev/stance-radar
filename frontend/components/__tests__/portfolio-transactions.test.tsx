import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import { PrivacyProvider } from "@/components/privacy-provider";
import { PortfolioTransactions } from "@/components/portfolio-transactions";

const messages = {
  Portfolio: {
    transactions: {
      title: "Transactions", add: "Add", buy: "Buy", sell: "Sell",
      shares: "Shares", price: "Price", dateLabel: "Date",
      note: "Note (optional)", tickerPlaceholder: "Ticker, e.g. AAPL",
      delete: "Delete", empty: "No transactions yet",
      addFailed: "Add failed: {message}", deleteFailed: "Delete failed: {message}",
    },
  },
};

const tx = {
  id: "t1", ticker: "AAPL", side: "buy", shares: 10, price: 100,
  executed_on: "2026-01-15", note: null, created_at: "2026-01-15T00:00:00Z",
};

function wrap(fetcher: (url: string) => Promise<unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SWRConfig value={{ fetcher, provider: () => new Map() }}>
        <PrivacyProvider>
          <PortfolioTransactions />
        </PrivacyProvider>
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("PortfolioTransactions", () => {
  it("lists transactions with a delete button", async () => {
    wrap(vi.fn().mockImplementation((url: string) =>
      url.startsWith("/api/portfolio/transactions")
        ? Promise.resolve([tx])
        : Promise.resolve([]),
    ));
    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("posts a new transaction on submit", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: tx, error: null })),
    );
    wrap(vi.fn().mockResolvedValue([]));
    await screen.findByText("Transactions");
    await userEvent.type(screen.getByPlaceholderText("Ticker, e.g. AAPL"), "aapl");
    await userEvent.type(screen.getByLabelText("Shares"), "10");
    await userEvent.type(screen.getByLabelText("Price"), "100");
    await userEvent.type(screen.getByLabelText("Note (optional)"), "first buy");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await vi.waitFor(() => {
      const call = fetchSpy.mock.calls.find(
        ([url, init]) => String(url) === "/api/portfolio/transactions" && init?.method === "POST",
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call![1]!.body));
      expect(body.ticker).toBe("AAPL");
      expect(body.shares).toBe(10);
      expect(body.note).toBe("first buy");
    });
  });

  it("masks shares but not price in privacy mode", async () => {
    localStorage.setItem("stance-radar-hide-amounts", "true");
    wrap(vi.fn().mockImplementation((url: string) =>
      url.startsWith("/api/portfolio/transactions")
        ? Promise.resolve([tx])
        : Promise.resolve([]),
    ));
    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText(/•••• × \$100/)).toBeInTheDocument();
    expect(screen.queryByText(/10 × \$100/)).toBeNull();
  });
});
