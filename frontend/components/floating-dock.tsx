"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Clamp a panel's top-left so it stays fully within the viewport. */
export function clampToViewport(
  x: number, y: number, w: number, h: number, vw: number, vh: number,
) {
  return {
    x: Math.max(0, Math.min(x, vw - w)),
    y: Math.max(0, Math.min(y, vh - h)),
  };
}

const FLOAT_PANEL =
  "fixed z-50 overflow-hidden rounded-xl border bg-background shadow-2xl";

export function FloatingDock({
  children,
  floatingWidth,
  navHeight = 56,
  sentinelOffset = 192,
  onClose,
}: {
  children: (state: { floating: boolean }) => React.ReactNode;
  floatingWidth: number;
  navHeight?: number;
  sentinelOffset?: number;
  onClose?: () => void;
}) {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState(false);
  const [closed, setClosed] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dockedHeight, setDockedHeight] = useState(0);

  // Float when the sentinel scrolls above the nav line; re-dock when it returns.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setFloating(false);
          setClosed(false); // re-docking clears a previous dismiss
        } else {
          setFloating(true);
        }
      },
      { rootMargin: `-${navHeight}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [navHeight]);

  // Measure docked content height for the placeholder used while floating.
  useEffect(() => {
    const el = measureRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!floating) setDockedHeight(el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [floating]);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const { width: w, height: h } = rect;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      setPos(
        clampToViewport(
          ev.clientX - offX, ev.clientY - offY, w, h,
          window.innerWidth, window.innerHeight,
        ),
      );
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const panel = panelRef.current;
      if (!panel) return;
      setPos((p) =>
        p
          ? clampToViewport(p.x, p.y, panel.offsetWidth, panel.offsetHeight, window.innerWidth, window.innerHeight)
          : p,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleClose = useCallback(() => {
    setClosed(true);
    onClose?.();
  }, [onClose]);

  const floatStyle: React.CSSProperties | undefined = !floating
    ? undefined
    : pos
      ? { width: floatingWidth, left: pos.x, top: pos.y }
      : { width: floatingWidth, right: 16, bottom: 16 };

  return (
    <div className="relative">
      <span
        ref={sentinelRef}
        aria-hidden
        className="pointer-events-none absolute left-0 h-px w-px"
        style={{ top: sentinelOffset }}
      />
      {floating && <div aria-hidden style={{ height: dockedHeight }} />}
      <div
        ref={panelRef}
        data-testid="floating-dock-panel"
        data-floating={floating ? "true" : "false"}
        className={cn(floating && FLOAT_PANEL, floating && closed && "hidden")}
        style={floatStyle}
      >
        {/* Handle is always rendered (hidden when docked) so the content below
            keeps a stable tree position → child is never remounted. */}
        <div className={cn("flex items-center gap-1 border-b bg-muted/40 px-2 py-1", !floating && "hidden")}>
          <div
            data-testid="floating-dock-handle"
            onPointerDown={onDragStart}
            className="h-4 flex-1 cursor-move select-none"
            aria-label="drag"
          />
          <button
            type="button"
            onClick={handleClose}
            aria-label="close"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div ref={measureRef}>{children({ floating })}</div>
      </div>
    </div>
  );
}
