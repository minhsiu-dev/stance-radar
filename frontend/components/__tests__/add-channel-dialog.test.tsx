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

import { AddChannelDialog } from "@/components/add-channel-dialog";

beforeEach(() => {
  useAdmin.mockReturnValue({ authenticated: true, handleAuthError: vi.fn() });
});

const messages = {
  Channels: {
    add: {
      title: "Add channel",
      placeholder: "Paste a channel ID, @handle or URL",
      submit: "Add",
      submitting: "Adding…",
      added: "Added {names}",
      skipped: "Already exists: {names}",
      autoFetch: "Checking…",
      failedGeneric: "Add failed",
    },
  },
};

describe("AddChannelDialog", () => {
  it("opens from the + button and submits a single value", async () => {
    envelopeSpy.mockResolvedValue({ body: { data: { added: [{ id: "UC1", title: "Chan" }], skipped: [], failed: [], job_id: null } } });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <AddChannelDialog />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add channel/i }));
    const input = await screen.findByPlaceholderText(/Paste a channel/i);
    fireEvent.change(input, { target: { value: "@chan" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(envelopeSpy).toHaveBeenCalledWith("/api/channels", expect.objectContaining({ method: "POST" }));
    });
    const [, opts] = envelopeSpy.mock.calls[0];
    expect(JSON.parse((opts as { body: string }).body)).toEqual({ channel_ids: "@chan" });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Paste a channel/i)).toBeNull();
    });
  });

  it("renders nothing when not authenticated", () => {
    useAdmin.mockReturnValue({ authenticated: false, handleAuthError: vi.fn() });
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <AddChannelDialog />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("routes a 401 response back through handleAuthError", async () => {
    const handleAuthError = vi.fn();
    useAdmin.mockReturnValue({ authenticated: true, handleAuthError });
    envelopeSpy.mockResolvedValue({ status: 401, body: { error: "Unauthorized" } });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <AddChannelDialog />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add channel/i }));
    const input = await screen.findByPlaceholderText(/Paste a channel/i);
    fireEvent.change(input, { target: { value: "@chan" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(handleAuthError).toHaveBeenCalledTimes(1);
    });
    const [err] = handleAuthError.mock.calls[0];
    expect(err).toMatchObject({ status: 401 });
  });
});
