import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useScrollShrink } from "@/lib/use-scroll-shrink";

function setScroll(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => window.dispatchEvent(new Event("scroll")));
}

describe("useScrollShrink", () => {
  it("maps scroll position to clamped [0,1] progress over `distance`", () => {
    setScroll(0);
    const { result } = renderHook(() => useScrollShrink(200));
    expect(result.current).toBe(0);
    setScroll(100);
    expect(result.current).toBeCloseTo(0.5);
    setScroll(200);
    expect(result.current).toBe(1);
    setScroll(9999);
    expect(result.current).toBe(1); // clamped
  });
});
