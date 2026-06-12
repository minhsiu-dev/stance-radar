import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatMarketCap,
  formatNumber,
  formatPercent,
  formatSeconds,
  formatVolume,
} from "@/lib/format";

describe("formatSeconds", () => {
  it("formats m:ss under an hour", () => {
    expect(formatSeconds(75)).toBe("1:15");
    expect(formatSeconds(12.5)).toBe("0:12");
  });
  it("formats h:mm:ss over an hour", () => {
    expect(formatSeconds(3723)).toBe("1:02:03");
  });
});

describe("formatPercent", () => {
  it("adds sign and two decimals", () => {
    expect(formatPercent(1.234)).toBe("+1.23%");
    expect(formatPercent(-0.5)).toBe("-0.50%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatMarketCap", () => {
  it("scales to T/B/M", () => {
    expect(formatMarketCap(2.9e12)).toBe("2.90T");
    expect(formatMarketCap(31e9)).toBe("31.00B");
    expect(formatMarketCap(null)).toBe("—");
  });
});

describe("formatVolume", () => {
  it("scales to B/M/K", () => {
    expect(formatVolume(50_000_000)).toBe("50.00M");
    expect(formatVolume(1_500)).toBe("1.5K");
    expect(formatVolume(null)).toBe("—");
  });
});

describe("formatNumber / formatDate", () => {
  it("handles null and dates", () => {
    expect(formatNumber(29.456)).toBe("29.46");
    expect(formatNumber(null)).toBe("—");
    expect(formatDate("2026-06-08T12:00:00+00:00")).toBe("2026-06-08");
  });
});
