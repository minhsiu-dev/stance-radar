"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Two-state collapse for a sticky page header, driven by an IntersectionObserver
 * against a sentinel's FIXED DOM position — so collapsing the header can never
 * move the sentinel and re-trigger itself (no scroll-linked feedback loop).
 *
 * Usage: place `sentinelRef` on a tiny absolutely-positioned marker `~N` px down
 * from the top of a `relative` container (that offset is the scroll distance
 * before collapse). `collapsed` flips true once the marker scrolls above the nav
 * line (`navHeight`) and false when it scrolls back.
 */
export function useStickyCollapse(navHeight = 56) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { rootMargin: `-${navHeight}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [navHeight]);
  return { sentinelRef, collapsed };
}
