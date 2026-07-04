"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/api";

type SessionState = { enabled: boolean; authenticated: boolean };

type PrivacyValue = {
  enabled: boolean;
  authenticated: boolean;
  locked: boolean;
  ready: boolean;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  /** @deprecated transitional alias for `locked`; removed once all consumers migrate. */
  hideHoldings: boolean;
};

const PrivacyContext = createContext<PrivacyValue>({
  enabled: false,
  authenticated: false,
  locked: false,
  ready: false,
  unlock: async () => false,
  lock: async () => {},
  hideHoldings: false,
});

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ enabled: false, authenticated: false });
  // `ready` is false until the first session read completes, so gated UI never flashes.
  const [ready, setReady] = useState(false);
  const { mutate } = useSWRConfig();

  useEffect(() => {
    apiFetch<SessionState>("/api/portfolio/session")
      .then(setState)
      .catch(() => setState({ enabled: false, authenticated: false }))
      .finally(() => setReady(true));
  }, []);

  const revalidate = useCallback(
    () => mutate((key) => typeof key === "string" && key.startsWith("/api/portfolio")),
    [mutate],
  );

  const unlock = useCallback(
    async (password: string) => {
      try {
        const res = await apiFetch<{ authenticated: boolean }>("/api/portfolio/unlock", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        if (!res.authenticated) return false;
      } catch {
        return false; // wrong password (or call failed) → treat as not unlocked
      }
      setState((s) => ({ ...s, authenticated: true }));
      await revalidate().catch(() => {});
      return true;
    },
    [revalidate],
  );

  const lock = useCallback(async () => {
    try {
      await apiFetch("/api/portfolio/lock", { method: "POST" });
    } catch {
      // best-effort: drop local state even if the backend call/network failed
    }
    setState((s) => ({ ...s, authenticated: false }));
    await revalidate().catch(() => {});
  }, [revalidate]);

  const locked = state.enabled && !state.authenticated;

  return (
    <PrivacyContext.Provider
      value={{ ...state, locked, ready, unlock, lock, hideHoldings: locked }}
    >
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
