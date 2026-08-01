import { describe, expect, it } from "vitest";
import {
  TICKER_PALETTE_DARK,
  TICKER_PALETTE_LIGHT,
  tickerColor,
  withAlpha,
} from "@/lib/ticker-palette";

// The site's stance-semantic colors (STANCE_COLORS in lib/markers.ts) — this
// chart's colors represent stocks, and must not collide with a stance color,
// or they'd be misread as buy/sell.
const STANCE_HEXES = ["#0ea5e9", "#f97316"];

describe("ticker palette", () => {
  it("has ten #rrggbb slots per mode", () => {
    for (const palette of [TICKER_PALETTE_LIGHT, TICKER_PALETTE_DARK]) {
      expect(palette).toHaveLength(10);
      for (const hex of palette) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("never reuses a stance colour", () => {
    for (const palette of [TICKER_PALETTE_LIGHT, TICKER_PALETTE_DARK]) {
      for (const hex of STANCE_HEXES) expect(palette).not.toContain(hex);
    }
  });

  it("keeps every slot distinct within a mode", () => {
    for (const palette of [TICKER_PALETTE_LIGHT, TICKER_PALETTE_DARK]) {
      expect(new Set(palette).size).toBe(palette.length);
    }
  });

  it("binds colour to rank, per mode", () => {
    expect(tickerColor(0, false)).toBe("#2a78d6");
    expect(tickerColor(0, true)).toBe("#3987e5");
    expect(tickerColor(9, false)).toBe("#7cb518");
  });

  it("wraps out-of-range ranks instead of returning undefined", () => {
    expect(tickerColor(10, false)).toBe(tickerColor(0, false));
  });

  it("converts hex to rgba", () => {
    expect(withAlpha("#2a78d6", 0.18)).toBe("rgba(42, 120, 214, 0.18)");
  });
});
