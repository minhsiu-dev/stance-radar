"use client";

import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "stance-radar-hide-amounts";

const PrivacyContext = createContext<{
  hideAmounts: boolean;
  toggle: () => void;
}>({ hideAmounts: false, toggle: () => {} });

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [hideAmounts, setHideAmounts] = useState(false);

  // SSR has no localStorage → read only after mount; always show on the first render
  useEffect(() => {
    setHideAmounts(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  function toggle() {
    setHideAmounts((prev) => {
      localStorage.setItem(STORAGE_KEY, String(!prev));
      return !prev;
    });
  }

  return (
    <PrivacyContext.Provider value={{ hideAmounts, toggle }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}

/** In privacy mode, replaces amounts/share counts with a masked string. */
export function masked(hide: boolean, text: string): string {
  return hide ? "••••" : text;
}
