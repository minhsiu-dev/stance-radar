"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { ApiError, apiFetch } from "@/lib/api";

type SessionState = { enabled: boolean; authenticated: boolean };

type AdminValue = {
  enabled: boolean;
  authenticated: boolean;
  ready: boolean;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  promptUnlock: () => void;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  handleAuthError: (err: unknown) => void;
};

const AdminContext = createContext<AdminValue>({
  enabled: false,
  authenticated: false,
  ready: false,
  dialogOpen: false,
  setDialogOpen: () => {},
  promptUnlock: () => {},
  unlock: async () => false,
  lock: async () => {},
  handleAuthError: () => {},
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ enabled: false, authenticated: false });
  const [ready, setReady] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { mutate } = useSWRConfig();

  useEffect(() => {
    apiFetch<SessionState>("/api/admin/session")
      .then(setState)
      .catch(() => setState({ enabled: false, authenticated: false }))
      .finally(() => setReady(true));
  }, []);

  // Refresh admin controls after any successful write revalidates data.
  const revalidateAll = useCallback(() => mutate(() => true), [mutate]);

  const unlock = useCallback(
    async (password: string) => {
      try {
        const res = await apiFetch<{ authenticated: boolean }>("/api/admin/unlock", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        if (!res.authenticated) return false;
      } catch {
        return false;
      }
      setState((s) => ({ ...s, enabled: true, authenticated: true }));
      await revalidateAll().catch(() => {});
      return true;
    },
    [revalidateAll],
  );

  const lock = useCallback(async () => {
    try {
      await apiFetch("/api/admin/lock", { method: "POST" });
    } catch {
      // best-effort
    }
    setState((s) => ({ ...s, authenticated: false }));
    await revalidateAll().catch(() => {});
  }, [revalidateAll]);

  const promptUnlock = useCallback(() => setDialogOpen(true), []);

  // Call from a write's catch block: an expired cookie mid-session flips us back to locked
  // and re-opens the password dialog.
  const handleAuthError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      setState((s) => ({ ...s, authenticated: false }));
      setDialogOpen(true);
    }
  }, []);

  return (
    <AdminContext.Provider
      value={{
        ...state,
        ready,
        dialogOpen,
        setDialogOpen,
        promptUnlock,
        unlock,
        lock,
        handleAuthError,
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
