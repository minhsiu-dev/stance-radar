"use client";

import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "stance-radar-hide-amounts";

const PrivacyContext = createContext<{
  hideAmounts: boolean;
  toggle: () => void;
}>({ hideAmounts: false, toggle: () => {} });

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [hideAmounts, setHideAmounts] = useState(false);

  // SSR 沒有 localStorage → 掛載後才讀,初次 render 一律顯示
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

/** 隱私模式下把金額/股數換成遮罩字串。 */
export function masked(hide: boolean, text: string): string {
  return hide ? "••••" : text;
}
