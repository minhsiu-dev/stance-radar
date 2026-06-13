import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useStickyCollapse } from "@/lib/use-sticky-collapse";

let ioCallback: (entries: { isIntersecting: boolean }[]) => void;
let ioOptions: IntersectionObserverInit | undefined;
const observe = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  observe.mockClear();
  disconnect.mockClear();
  // @ts-expect-error minimal mock
  global.IntersectionObserver = class {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void, opts?: IntersectionObserverInit) {
      ioCallback = cb;
      ioOptions = opts;
    }
    observe = observe;
    disconnect = disconnect;
    unobserve = vi.fn();
    takeRecords = vi.fn();
  };
});

function Probe({ nav = 56 }: { nav?: number }) {
  const { sentinelRef, collapsed } = useStickyCollapse(nav);
  return (
    <div>
      <div ref={sentinelRef} />
      <span data-testid="state">{collapsed ? "collapsed" : "expanded"}</span>
    </div>
  );
}

describe("useStickyCollapse", () => {
  it("starts expanded, collapses when the sentinel leaves, expands when it returns", () => {
    render(<Probe nav={56} />);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(ioOptions?.rootMargin).toContain("-56px");
    expect(screen.getByTestId("state").textContent).toBe("expanded");
    act(() => ioCallback([{ isIntersecting: false }]));
    expect(screen.getByTestId("state").textContent).toBe("collapsed");
    act(() => ioCallback([{ isIntersecting: true }]));
    expect(screen.getByTestId("state").textContent).toBe("expanded");
  });
});
