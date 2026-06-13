import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StanceMiniBar } from "@/components/stance-mini-bar";

const zone = (count: number) => ({ count, avatars: [] });

describe("StanceMiniBar", () => {
  it("renders one segment per non-zero stance with proportional width", () => {
    const { container } = render(
      <StanceMiniBar stances={{ buy: zone(3), neutral: zone(0), sell: zone(1) }} />,
    );
    // container.firstElementChild is the outer flex wrapper; its children are the colored segments
    const outer = container.firstElementChild as HTMLElement;
    const segs = outer.children;
    expect(segs.length).toBe(2); // buy + sell, neutral omitted
    expect((segs[0] as HTMLElement).style.width).toBe("75%");
    expect((segs[1] as HTMLElement).style.width).toBe("25%");
  });
  it("renders nothing when all zero", () => {
    const { container } = render(
      <StanceMiniBar stances={{ buy: zone(0), neutral: zone(0), sell: zone(0) }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
