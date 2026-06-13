"use client";

import { useEffect, useState } from "react";

/** Scroll progress in [0,1] over the first `distance` px of vertical scroll. */
export function useScrollShrink(distance: number): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const p = distance <= 0 ? 1 : Math.min(1, Math.max(0, window.scrollY / distance));
      setProgress(p);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [distance]);
  return progress;
}
