import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { FloatingDock, clampToViewport } from "@/components/floating-dock";

let ioCb: (e: { isIntersecting: boolean }[]) => void;
beforeEach(() => {
  // @ts-expect-error minimal mock
  global.IntersectionObserver = class {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void) { ioCb = cb; }
    observe = vi.fn(); disconnect = vi.fn(); unobserve = vi.fn(); takeRecords = vi.fn();
  };
  global.ResizeObserver = class {
    observe = vi.fn(); disconnect = vi.fn(); unobserve = vi.fn();
  };
});

describe("clampToViewport", () => {
  it("keeps the panel fully on screen", () => {
    expect(clampToViewport(-50, -50, 100, 100, 1000, 800)).toEqual({ x: 0, y: 0 });
    expect(clampToViewport(9999, 9999, 100, 100, 1000, 800)).toEqual({ x: 900, y: 700 });
    expect(clampToViewport(300, 200, 100, 100, 1000, 800)).toEqual({ x: 300, y: 200 });
  });
});

describe("FloatingDock", () => {
  function renderDock() {
    return render(
      <FloatingDock floatingWidth={360}>
        {({ floating }) => <div data-testid="child">{floating ? "float" : "dock"}</div>}
      </FloatingDock>,
    );
  }

  it("renders docked initially (panel not fixed) and floats when the sentinel leaves", () => {
    renderDock();
    const panel = screen.getByTestId("floating-dock-panel");
    expect(panel.getAttribute("data-floating")).toBe("false");
    expect(panel.className).not.toContain("fixed");
    act(() => ioCb([{ isIntersecting: false }]));
    expect(panel.getAttribute("data-floating")).toBe("true");
    expect(panel.className).toContain("fixed");
  });

  it("keeps the SAME child node across dock→float (no remount)", () => {
    renderDock();
    const before = screen.getByTestId("child");
    act(() => ioCb([{ isIntersecting: false }]));
    const after = screen.getByTestId("child");
    expect(after).toBe(before); // same DOM node → not remounted
  });

  it("close hides the floating panel; re-docking restores it", () => {
    renderDock();
    act(() => ioCb([{ isIntersecting: false }]));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.getByTestId("floating-dock-panel").className).toContain("hidden");
    act(() => ioCb([{ isIntersecting: true }]));
    const panel = screen.getByTestId("floating-dock-panel");
    expect(panel.getAttribute("data-floating")).toBe("false");
    expect(panel.className).not.toContain("hidden");
  });
});
