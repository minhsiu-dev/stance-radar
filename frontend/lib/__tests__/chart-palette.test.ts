import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("chart palette", () => {
  it("defines --chart-1..5 with non-zero chroma in :root", () => {
    const css = readFileSync(
      join(__dirname, "../../app/globals.css"),
      "utf8",
    );
    const root = css.split(":root")[1]?.split("}")[0] ?? "";
    for (let i = 1; i <= 5; i++) {
      expect(root).toMatch(new RegExp(`--chart-${i}: oklch\\(`));
    }
    const matches = [...root.matchAll(/--chart-\d+: oklch\(([^)]+)\)/g)];
    const chromaNonZero = matches.filter((m) => {
      const parts = m[1].split(/\s+/);
      return parseFloat(parts[1]) > 0;
    }).length;
    expect(chromaNonZero).toBeGreaterThanOrEqual(3);
  });
});
