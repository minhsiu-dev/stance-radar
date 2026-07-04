import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
const mutate = vi.fn().mockResolvedValue(undefined);
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate }) }));

import { PrivacyProvider, usePrivacy } from "@/components/privacy-provider";

function Probe() {
  const { enabled, authenticated, locked, ready, unlock, lock } = usePrivacy();
  return (
    <div>
      <span data-testid="state">{`${ready}|${enabled}|${authenticated}|${locked}`}</span>
      <button onClick={() => unlock("pw")}>unlock</button>
      <button onClick={() => lock()}>lock</button>
    </div>
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  mutate.mockClear();
});

describe("PrivacyProvider", () => {
  it("reads /session on mount → locked when enabled and not authenticated", async () => {
    apiFetch.mockResolvedValueOnce({ enabled: true, authenticated: false });
    render(<PrivacyProvider><Probe /></PrivacyProvider>);
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("true|true|false|true"),
    );
    expect(apiFetch).toHaveBeenCalledWith("/api/portfolio/session");
  });

  it("unlock success flips authenticated and revalidates portfolio SWR", async () => {
    apiFetch.mockResolvedValueOnce({ enabled: true, authenticated: false });
    render(<PrivacyProvider><Probe /></PrivacyProvider>);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("true|true|false|true"));
    apiFetch.mockResolvedValueOnce({ authenticated: true });
    await userEvent.click(screen.getByText("unlock"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("true|true|true|false"));
    expect(mutate).toHaveBeenCalled();
  });

  it("unlock stays locked when the password is wrong (apiFetch throws)", async () => {
    apiFetch.mockResolvedValueOnce({ enabled: true, authenticated: false });
    render(<PrivacyProvider><Probe /></PrivacyProvider>);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("true|true|false|true"));
    apiFetch.mockRejectedValueOnce(new Error("401"));
    await userEvent.click(screen.getByText("unlock"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("true|true|false|true"));
  });

  it("lock drops local state and revalidates even when the backend call fails", async () => {
    apiFetch.mockResolvedValueOnce({ enabled: true, authenticated: true });
    render(<PrivacyProvider><Probe /></PrivacyProvider>);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("true|true|true|false"));
    apiFetch.mockRejectedValueOnce(new Error("network"));
    await userEvent.click(screen.getByText("lock"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("true|true|false|true"));
    expect(mutate).toHaveBeenCalled();
  });
});
