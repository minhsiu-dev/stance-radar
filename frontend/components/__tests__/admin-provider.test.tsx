import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch, ApiError } = vi.hoisted(() => {
  const apiFetch = vi.fn();
  class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
  }
  return { apiFetch, ApiError };
});
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError,
}));
const mutate = vi.fn().mockResolvedValue(undefined);
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate }) }));

import { AdminProvider, useAdmin } from "@/components/admin-provider";

function Probe() {
  const { enabled, authenticated, ready, unlock, lock } = useAdmin();
  return (
    <div>
      <span data-testid="state">{`${ready}|${enabled}|${authenticated}`}</span>
      <button onClick={() => unlock("pw")}>unlock</button>
      <button onClick={() => lock()}>lock</button>
    </div>
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  mutate.mockClear();
});

describe("AdminProvider", () => {
  it("reads /session on mount", async () => {
    apiFetch.mockResolvedValueOnce({ enabled: true, authenticated: false });
    render(<AdminProvider><Probe /></AdminProvider>);
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("true|true|false"));
    expect(apiFetch).toHaveBeenCalledWith("/api/admin/session");
  });

  it("unlock success flips authenticated and revalidates", async () => {
    apiFetch.mockResolvedValueOnce({ enabled: true, authenticated: false });
    render(<AdminProvider><Probe /></AdminProvider>);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("true|true|false"));
    apiFetch.mockResolvedValueOnce({ authenticated: true });
    await userEvent.click(screen.getByText("unlock"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("true|true|true"));
    expect(mutate).toHaveBeenCalled();
  });

  it("unlock stays locked when password wrong (apiFetch throws)", async () => {
    apiFetch.mockResolvedValueOnce({ enabled: true, authenticated: false });
    render(<AdminProvider><Probe /></AdminProvider>);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("true|true|false"));
    apiFetch.mockRejectedValueOnce(new ApiError("Wrong password", 401));
    await userEvent.click(screen.getByText("unlock"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("true|true|false"));
  });
});
