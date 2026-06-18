"use client";

import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "stance-radar-hide-holdings";

const PrivacyContext = createContext<{
  hideHoldings: boolean;
  ready: boolean;
  toggle: () => void;
}>({ hideHoldings: false, ready: false, toggle: () => {} });

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [hideHoldings, setHideHoldings] = useState(false);
  // `ready` is false during SSR + the first client render, so holdings data never
  // renders before we've read the setting (no flash); true after the mount read.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setHideHoldings(localStorage.getItem(STORAGE_KEY) === "true");
    setReady(true);
  }, []);

  function toggle() {
    setHideHoldings((prev) => {
      localStorage.setItem(STORAGE_KEY, String(!prev));
      return !prev;
    });
  }

  return (
    <PrivacyContext.Provider value={{ hideHoldings, ready, toggle }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
